# MCPdia: project brief

Read this first, then the docs it points to. Do not start coding before reading `docs/decisions/`, `docs/schema.md`, and `docs/SCOPE.md`.

## What this is
A glossary backed by a knowledge graph, exposed to LLMs over MCP. It persists information between context windows ("remember this") and later serves as shared team knowledge ("how the permission system works"). The core purpose is **saving tokens**: the original problem was reading whole markdown files to find one fact.

It is a public, open-source project. That means: finished and polished beats sprawling, tests and CI matter, and a measured token-savings result belongs in the README headline.

## Architecture (ADR 0001)
Three layers, TypeScript, async throughout:
1. **MCP tools:** thin adapters, no logic.
2. **Core:** all rules (dedupe hints, type normalization, versioning, render levels). Knows nothing about MCP or storage.
3. **GraphStore:** storage interface. SQLite first, Postgres later. No raw SQL outside the store layer.

Every core call receives a `context` object (caller, namespaces). `context.namespaces` is a **list**. Never hard-code `'default'` outside context defaults.

## Rules that shape the code
- **Token economy first.** Responses are small by default. Read tools use render levels: `title`, `summary`, `snippet`, `full` (ADR 0004).
- **Types are free-form strings**, normalized only for case/whitespace/separators. Suggest ("did you mean?"), never block (ADR 0002).
- **Identity:** ULID ids for internal references; `(namespace, key)` is the stable cross-graph identity. Edges are late-bound: they store namespace + key for both ends, with nullable resolved ids (ADR 0003, 0007).
- **Nothing is hard-deleted.** Use `status` (active/superseded/deleted), `version`, and `node_versions` snapshots.
- **Tools are named for intent** and the core does the bookkeeping, e.g. `annotate` creates a linked note node (ADR 0008). Notes and observations are separate nodes; edit a node's body only to correct shared facts.
- **Guidance lives in tool descriptions and `orient` text.** No write-time size limits or growth warnings.
- **Keep tool descriptions short.** They are loaded every session. Avoid near-duplicate tools.
- `orient` stays tiny (a few hundred tokens at most), is configurable via settings, and accepts optional `focus` keywords returning title-level results.
- `feedback` is its own tool (`useful`, `not_useful`, `outdated_or_wrong`). `recent` tracks writes and useful-marked nodes, not reads (ADR 0005).

## Current target: v0.1 (see `docs/SCOPE.md`)
Core + SQLite store + numbered-SQL migrations, FTS5 search, and the tools `orient`, `search`, `get`, `upsert`, `link` first; then `annotate`, `feedback`, `recent`, `supersede`, `verify`, `delete` (soft), `list_types`. Then the benchmark harness comparing markdown-file memory with the graph.

Out of scope for v0.1: auth, Postgres, Docker/HTTP, embeddings, import/merge. The optional graph viewer in `viewer/` shipped early (ADR 0014). Do not build these, but do not make choices that block them.

## Working agreements
- **Record decisions.** When a design decision is made or changed, add or supersede an ADR in `docs/decisions/` and update the index. The reasoning trail is part of the deliverable.
- Keep `docs/schema.md` and `docs/SCOPE.md` in sync with the code, including the release diary in `SCOPE.md`.
- **Pick SQLite tooling by checking current state** (`better-sqlite3`, Node's built-in `node:sqlite`, or `libsql`) and record the choice in an ADR. Verify FTS5 support.
- Write tests alongside code. The `GraphStore` test suite should be reusable so the Postgres adapter can run the same tests later.
- Prefer small dependencies and a hand-rolled migration runner over heavy frameworks.
- If something in these docs seems wrong or unclear, say so and propose a change rather than silently deviating.

## Naming
The project is **MCPdia**, short for Model Context Protocol: Distilled, Indexed Answers (ADR 0022, which replaced the earlier name MCPedia). The npm package is `@bradwagoner/mcpdia`. Runtime names use it too: `MCPDIA_DB`, `MCPDIA_METRICS`, `~/.mcpdia/mcpdia.db`.
