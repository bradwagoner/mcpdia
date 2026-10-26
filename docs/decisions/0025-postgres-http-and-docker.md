# 0025: Postgres store, HTTP transport and a Docker image

- Status: Proposed
- Date: 2026-10-22

## Context
ADR 0006 promises one codebase with a team mode: the same core behind an HTTP server in Docker, backed by Postgres. Solo mode (SQLite over stdio) is done and benchmarked. The `GraphStore` interface is async and already has a shared contract suite (`test/store/graphstore.suite.ts`) written to run against a second store. Auth and per-namespace permissions are still later v0.3 work, so the first image must be safe without them.

## Decision
**A `PostgresStore` behind the same `GraphStore` interface, a Streamable HTTP transport, and a Docker Compose file that runs both.**

Store (`src/store/postgres/`)
- Driver: `pg` (node-postgres), the standard Node client, pure JavaScript. A small `PgDatabase` interface (query, multi-statement exec, transaction) sits between the store and the driver, so tests can swap in PGlite.
- Schema: its own numbered SQL files, same tables and columns as SQLite, with three Postgres-shaped differences. Aliases and tags are sorted `text[]` columns on `nodes` instead of side tables. JSON is `jsonb`. A `seq` identity column keeps insertion order for ties, as SQLite's `rowid` does. Timestamps stay ISO text so both stores compare and sort them the same way.
- Migrations run in a transaction per file under an advisory lock, so servers starting together apply each file once.
- Search: Postgres full-text search on a weighted `tsvector` kept by a trigger (title A, summary and aliases B, tags C, body D) with a GIN index. The text search config `mcpdia` is English Snowball stemming with no stop words, matching SQLite's `porter` tokenizer, so the core's stop-word fallback behaves the same on both. Ranked by `ts_rank` with weights in the same ratio as SQLite's bm25 column weights and the same small useful-count boost. Rankings are close to SQLite's but not identical; the contract suite checks behavior, not exact scores.
- Picked by `MCPDIA_DATABASE_URL`. When it is set (`postgres://…`), the server and `mcpdia export` use Postgres; otherwise the SQLite file at `MCPDIA_DB`, as before. Startup logs mask the password.

Transport (`src/http.ts`)
- `mcpdia --http` serves MCP over Streamable HTTP at `/mcp`, stateless: each request gets a fresh MCP server over the shared store. No sessions to track, and any number of clients can connect. `GET /health` answers `ok` for container health checks.
- Listens on `MCPDIA_HTTP_HOST:MCPDIA_HTTP_PORT`, default `127.0.0.1:7411`.
- Answers only requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]`, plus names in `MCPDIA_HTTP_ALLOWED_HOSTS`. That blocks DNS rebinding from a web page, as the viewer does.
- stdio stays the default, so existing setups don't change.

Docker
- `Dockerfile`: two stages on `node:22-slim`. `npm ci --ignore-scripts` is enough because better-sqlite3 ships prebuilt binaries. Runs as the `node` user, starts `mcpdia --http` on `0.0.0.0:7411`, with a health check.
- On its own the image keeps a SQLite graph in the `/data` volume; `docker-compose.sqlite.yml` runs it that way with the viewer. `docker-compose.yml` adds `postgres:17`, waits for it to be healthy, and points the server at it. Postgres is not published; the server and the read-only viewer (which also reads Postgres now) are published on `127.0.0.1` only.
- Metrics stay opt-in (ADR 0019): `MCPDIA_METRICS=1 docker compose up -d`. With Postgres there is no database folder to log next to, so `MCPDIA_METRICS_FILE` names the file; the image sets `/data/mcpdia-metrics.jsonl`, on the volume.

Tests
- The shared contract suite runs against Postgres on every `npm test` using PGlite (real Postgres compiled to WebAssembly, in-process). No Docker or server needed on a dev machine or in CI.
- `MCPDIA_TEST_DATABASE_URL` also runs the suite against a real Postgres server, which it wipes before each test.
- `test/http.test.ts` drives the HTTP server with the SDK's HTTP client over real sockets.

## Alternatives considered
- **stdio inside the container** (`docker run -i`). Works for one local client, but every client starts its own container, and it can't serve a team. HTTP is what ADR 0006 calls for.
- **Stateful HTTP sessions.** The tools keep no per-session state, so sessions would add bookkeeping with nothing to show for it.
- **The `english` text search config.** It drops stop words, so a query of only stop words would find nothing on Postgres and something on SQLite.
- **Testing only against a Postgres server in Docker.** Real, but `npm test` would need Docker running. PGlite keeps the suite one command.
- **An ORM or query builder.** Two small hand-written stores are easier to read than a layer that hides the SQL.

## Consequences
- Team mode exists as a one-command quickstart (`docker compose up -d`). Until auth lands, the HTTP server is for localhost or a trusted network, and the docs say so.
- Two stores to keep in step: every schema change needs a migration for each, and the shared suite catches drift.
- `pg` becomes a runtime dependency; PGlite is dev-only.
- Search ranking can differ slightly between the stores. Lookup tests (ADR 0024) stay on SQLite.
- Moving a graph between stores waits for JSONL import (v0.2).
