# Scope and Release Diary

This file does two jobs: it states what each release will and will not include, and it records what actually shipped. Scope is written *before* building; the diary section is filled in *after*.

**Principle:** a finished, polished v1 beats a sprawling half-built one. Anything not listed under a release is out of scope for it.

---

## v0.1: Solo, local, useful on day one

**Goal:** replace markdown-file memory with a graph that costs fewer tokens, and prove it with numbers.

**In scope**
- TypeScript core with async `GraphStore` interface; SQLite implementation
- Numbered-SQL migration runner
- MCP tools named for intent (ADR 0008): `orient`, `search`, `get`, `upsert`, `annotate`, `link`, `supersede`, `verify`, `delete` (soft), `list_types`, `recent`, `feedback`. Count follows distinct intents; descriptions stay short. Contracts are in `docs/tools.md`.
- Render levels (`title` / `summary` / `snippet` / `full`) on all read tools
- Full-text search (SQLite FTS5)
- Type registry with normalization, and a hint when a type is new (ADR 0018)
- Configurable `orient` (presets: `minimal`, `standard`, `verbose`)
- Stable keys, namespaces, source, author, versioning, soft delete
- Late-bound edges (namespace + key references with nullable resolved ids), so multi-dataset support needs no schema change later (ADR 0007)
- JSONL export (import is v0.2)
- Benchmark: same tasks using markdown files vs. the graph; result goes in the README headline (ADR 0023)
- Unit and integration tests, CI, README, license, security notes (including prompt injection)

**Out of scope for v0.1**
- Auth, permissions, multi-user
- Postgres, Docker, HTTP transport
- Embeddings / vector search
- Import and merge

## v0.2: Cleanup and packs

- Candidate finders (duplicate nodes, near-duplicate types), health reports
- Bulk operations with dry-run: `merge_nodes`, `rename_type`, `merge_types`
- Packaged MCP prompts: dedupe, audit stale nodes, standardize types, seed from a document or repo
- Pruner prompts start from recently edited nodes; a node whose body grew sharply (for example +50% vs. its previous version) weighs higher as a candidate to flag or split. Growth is measured from `node_versions.body_len` (ADR 0008)
- JSONL import with conflict policies (skip / overwrite / keep both)
- Seed from file or remote URL at setup; load by namespace

## v0.3: Team mode

- Postgres adapter, shared test suite across both stores
- HTTP transport, Docker image, one-command quickstart
- Token-based auth, per-namespace permissions
- Documented AWS deployment path

## Later / ideas (unscheduled)

- Multi-dataset support: ghost references for edges into unloaded namespaces (collapsed by default), a namespace-to-pack catalog with load hints (ADR 0007)
- Embeddings as an optional search signal
- Markdown import/export
- Per-type validation from type definitions

---

## Release diary

Newest first. Each entry: what shipped, what changed from the plan, what we learned.

### Unreleased
- New name (2026-10-20): the project is MCPdia, "Model Context Protocol: Distilled, Indexed Answers", replacing MCPedia to avoid an unrelated project with that name. The package is `@bradwagoner/mcpdia` and the command `mcpdia`; runtime names such as `MCPEDIA_DB` and `~/.mcpedia` stay for now (ADR 0022).
- Headline (2026-10-20, #8): the README result comes from live Claude sessions in `bench/sessions`, not the scripted benchmark. On Claude Haiku 5.5, ten read and write tasks, two repeats: MCPdia passed 20/20 at $0.0027 per session, one big `CLAUDE.md` 20/20 at $0.0049, and an index with split topic files 19/20 at $0.0022 (ADR 0023, superseding the never-accepted ADR 0013). README rewritten around it, with a CI badge (#7).
- Search top-up (2026-10-19): when fewer nodes match every word than the limit, `search` fills the rest with partial matches, labelled with the words they matched, after the full ones. Before, one weak node that matched every word hid better partial matches; bench step 6 missed the EU region and the API SLO that way (ADR 0021).
- Snippets show the match (2026-10-19): when a searched word only appears past the 300-character cut, a `search` snippet shows about 100 characters of intro, then the text around that word, cut at whole words, with `(+N chars)` for what was left out. Found by the bench: a question about the live API key prefix missed because the answer started 21 characters past the cut (ADR 0020).
- Graph viewer (2026-10-15 to 2026-10-19): an optional, read-only browser view of a graph in `viewer/`, with its own dependencies and two renderers kept at parity, Sigma.js and Cytoscape.js (ADR 0014). `--lan` opts in to serving it on the local network. Changed from the plan: the viewer was out of scope for v0.1, but browsing what agents wrote proved too useful for testing to wait.
- Metrics log (2026-10-19, #23): `MCPEDIA_METRICS=1` appends one JSON line per tool call to `mcpedia-metrics.jsonl` next to the database: tool, time, duration, ok, request and response size in characters, render level and a session id. Raw facts only; the bench joins it with Claude's usage reports (ADR 0019). Changed from the first cut: no database table and no `stats` command.
- Smaller session cost (2026-10-19, #15): `upsert.version` is a plain number, so its listing no longer carries the safe-integer bounds zod adds to integers; a few parameter hints that repeated their names are gone; and stubs no longer say "never verified". The fixed session cost went from about 1,790 to 1,740 estimated tokens (3% less), and the median search-then-get answer from 322 to 314. The `$schema` key the SDK adds to every tool (about 150 tokens) stays until the SDK can leave it out.
- Install check (2026-10-16, #5): confirmed `npm install` needs no build tools on Windows, since better-sqlite3 ships prebuilt binaries in the package (ADR 0010). A test fails if an upgrade brings node-gyp back.
- No guesses (2026-10-16): tools no longer answer with "did you mean". A new type, an unknown type filter or a missing key is stated as a fact with where to look (ADR 0018).
- Deleted nodes (2026-10-16, #31): `get` and `search` take `all_status` to read deleted and superseded nodes, and `upsert` on a deleted key restores the node instead of refusing (ADR 0017).
- Tool messages (2026-10-16, #10, #11): results now say what the server knows: partial search matches with the words they matched, nodes flagged outdated or wrong, deleted and superseded keys, dangling links after a delete, parent loops, dropped properties and missing summaries (ADR 0016). Question words like "what is" are dropped from queries. Migration 002 adds `last_wrong_at`.
- Links on create (2026-10-15, #30): `upsert` takes `links` and writes the node's edges in the same call, and its result points out a new node with no parent (ADR 0015).
- Repo cleanup (2026-10-13): removed the planning handoff document (its decisions live in the ADRs), untracked IntelliJ project files, and relabelled the README feature list so planned work is marked as planned.
- JSONL export (2026-10-13, KAN-6): `mcpedia export [--namespace ns]... [--all-status] [--out file]` writes a header, the active nodes (every status with `--all-status`), then the active edges. Format in `docs/schema.md`. Version history is not exported.
- Benchmark harness, first cut (2026-10-12): demo dataset (Kestrel, a fictional invoicing app: 82 nodes, 7 markdown topic files, 40 questions) in `bench/dataset/`, shared with demos through `npm run demo:seed`; scripted strategies and token counting per ADR 0013 (proposed); `npm run bench`. First estimate: MCPedia's retrieval is far cheaper per question, but its fixed session cost (mostly tool definitions, about 1,600 tokens) cancels the saving against well-split topic files at this corpus size. No headline published yet.
- Repo housekeeping (2026-10-12): MIT `LICENSE`, README status and license lines updated, placeholder "buy me a beer" link removed until there is a real one, and `.gitattributes` forcing LF so Prettier's check passes on Windows CI checkouts.
- Remaining v0.1 tools (2026-10-07): `annotate`, `supersede`, `verify`, soft `delete`, `feedback`, `recent`, `list_types`. `supersede` moves the old node's links and adds a `supersedes` edge for history. `verify` does not create a version. `maintain` waits for v0.2, when there are cleanup operations for it to run.
- Tooling: Prettier, CI on Linux, Windows and macOS with Node 22 and 24, and a test that enforces the ADR 0001 layer rules. Changed from the plan: no ESLint. typescript-eslint does not support TypeScript 7 yet, and the boundary test covers the rule ESLint was going to enforce.
- First vertical slice (2026-10-07): TypeScript core, async `GraphStore` with a better-sqlite3 implementation, numbered-SQL migrations, FTS5 search with stemming, and the tools `orient`, `search`, `get`, `upsert`, `link`. One store test suite ready to reuse for Postgres. Next: `annotate`, `feedback`, `recent`, `supersede`, `verify`, `delete`, `list_types`, `maintain`, then the benchmark.
- Decided: better-sqlite3 (ADR 0010), compact text responses and a `get` cap that is a setting (ADR 0011), word-built keys and the separator rules (ADR 0012). Tags normalize like node types (schema open question 4).
- Changed from the plan: migrations live in `src/store/sqlite/migrations/`, since each store owns its SQL dialect.
- Design phase complete: architecture, data model, and six decision records (see `docs/decisions/`).
- First-pass schema drafted (see `docs/schema.md`).
- Schema revised: edges are now late-bound (namespace + key, nullable resolved ids) and `node_versions` records `body_len` (ADR 0007, 0008).
- Tool surface reframed around caller intent (`annotate`, `supersede`, `verify`) rather than a fixed tool-count target (ADR 0008).
