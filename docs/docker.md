# Docker

MCPdia runs as a shared server over HTTP: one graph that every connected client reads and writes. Pick the store: Postgres for a team, or SQLite for one machine with nothing else to run. Either way the read-only viewer comes along.

## Postgres with Compose

```bash
docker compose up -d
claude mcp add --transport http mcpdia http://localhost:7411/mcp
```

That starts Postgres 17, the server and the read-only [graph viewer](../viewer/README.md) at http://localhost:7412, waits for the database, and creates the schema on first start. The viewer follows the graph live as clients write to it. The graph lives in the `pgdata` volume, so it survives `docker compose down` and rebuilds. `docker compose down -v` deletes it.

Set `POSTGRES_PASSWORD` before the first start to use your own password (it defaults to `mcpdia`). Postgres is not published outside the Compose network.

Rebuild after pulling changes with `docker compose up -d --build`.

## SQLite with Compose

```bash
docker compose -f docker-compose.sqlite.yml up -d
claude mcp add --transport http mcpdia http://localhost:7411/mcp
```

Same server and viewer, with the graph in one SQLite file, `/data/mcpdia.db` in the `mcpdia-data` volume. Both stacks use ports 7411 and 7412, so run one at a time.

## The image on its own

```bash
docker build -t mcpdia .
docker run -d -p 127.0.0.1:7411:7411 -v mcpdia-data:/data mcpdia
```

Without `MCPDIA_DATABASE_URL` the server uses SQLite at `/data/mcpdia.db`.

## Settings

| Variable | Default in the image | What it does |
| --- | --- | --- |
| `MCPDIA_DATABASE_URL` | unset | A `postgres://` URL. When set, the graph lives in Postgres. |
| `MCPDIA_DB` | `/data/mcpdia.db` | The SQLite file, used when no database URL is set. |
| `MCPDIA_HTTP_HOST` | `0.0.0.0` | Address to listen on. Outside Docker the default is `127.0.0.1`. |
| `MCPDIA_HTTP_PORT` | `7411` | Port to listen on. |
| `MCPDIA_HTTP_ALLOWED_HOSTS` | unset | Comma-separated host names to answer besides `localhost`, e.g. `graph.internal`. |
| `MCPDIA_METRICS` | `0` | `1` logs every tool call ([metrics](../README.md#measure-it-yourself)). |
| `MCPDIA_METRICS_FILE` | `/data/mcpdia-metrics.jsonl` | Where the metrics log goes. |
| `MCPDIA_STARTERS` | unset | Starter sets to load at startup, `name=source,...`; a source is a file or an `http(s)` URL ([starter sets](#load-this-graph-into-your-own-mcpdia)). |
| `MCPDIA_NAMESPACES` | unset | Comma-separated namespaces to read besides your own. |
| `MCPDIA_WRITE_NAMESPACE` | `default` | Where writes go. |

Metrics with Compose: `MCPDIA_METRICS=1 docker compose up -d`. The log is in the `mcpdia-data` volume; `docker compose exec mcpdia cat /data/mcpdia-metrics.jsonl` prints it.

Export works inside the container too: `docker compose exec mcpdia node dist/index.js export --out /data/graph.jsonl`, then `docker compose cp mcpdia:/data/graph.jsonl .` to copy it out. Use `--out` rather than a `>` redirect: Windows PowerShell 5.1 writes redirects as UTF-16.

## Load this graph into your own MCPdia

The server serves its graph as an export at `GET /export`, with `?tag=` and `?namespace=` to narrow it. Another MCPdia can load that as a starter set: a copy next to its own graph, refreshed at each start (ADR 0026). Edit it freely; if the team changes a node you edited, your MCPdia lists a conflict to review rather than overwriting you.

```bash
claude mcp add mcpdia -e MCPDIA_STARTERS=team=http://localhost:7411/export -- node /path/to/mcpdia/dist/index.js
```

Your model then searches your notes and the team's in one call, with the team's keys shown as `team:concept/x`, and your writes stay in your own graph. If the server is down when yours starts, yours keeps the copy it loaded last time. `/export` follows the same localhost-only rule as `/mcp`. If you want every edit live instead, register the server itself, as above.

## HTTP outside Docker

`mcpdia --http` serves the same endpoint from a normal install, on `127.0.0.1:7411`. Without `--http` the server speaks stdio as usual.

## Security

There is no authentication yet, so anyone who can reach the port can read and write the graph. Compose publishes it on `127.0.0.1` only, and the server answers only to `localhost` host names (plus any in `MCPDIA_HTTP_ALLOWED_HOSTS`), so a web page can't reach it through DNS rebinding. Token auth is on the [roadmap](SCOPE.md#v03-team-mode); until then, keep it on your machine or a network you trust. More in [SECURITY.md](../SECURITY.md).
