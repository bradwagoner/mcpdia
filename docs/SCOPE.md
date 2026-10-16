# Scope and Release Diary

This file does two jobs: it states what each release will and will not include, and it records what actually shipped. Scope is written *before* building; the diary section is filled in *after*.

**Principle:** a finished, polished v1 beats a sprawling half-built one. Anything not listed under a release is out of scope for it.

---

## v0.1: Solo, local, useful on day one

**Goal:** replace markdown-file memory with a graph that costs fewer tokens, and prove it with numbers.

**In scope**
- TypeScript core with async `GraphStore` interface; SQLite implementation
- Numbered-SQL migration runner
- MCP tools named for intent (ADR 0008): `orient`, `search`, `get`, `upsert`, `annotate`, `link`, `supersede`, `verify`, `delete` (soft), `list_types`, `recent`, `feedback`, plus one `maintain` entry point. Count follows distinct intents; descriptions stay short. Exact contracts are still to be drafted.
- Render levels (`title` / `summary` / `snippet` / `full`) on all read tools
- Full-text search (SQLite FTS5)
- Type registry with normalization and "did you mean?" hints
- Configurable `orient` (presets: `minimal`, `standard`, `verbose`)
- Stable keys, namespaces, source, author, versioning, soft delete
- Late-bound edges (namespace + key references with nullable resolved ids), so multi-dataset support needs no schema change later (ADR 0007)
- JSONL export (import is v0.2)
- Benchmark harness: same task using markdown files vs. the graph; result goes in the README headline
- Unit and integration tests, CI, README, license, security notes (including prompt injection)

**Out of scope for v0.1**
- Auth, permissions, multi-user
- Postgres, Docker, HTTP transport
- Embeddings / vector search
- Import and merge
- Graph viewer

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
- Minimal graph viewer
- Markdown import/export
- Per-type validation from type definitions
- Project name and branding (current options: Lore, Mycelium, a recursive acronym)

---

## Release diary

Newest first. Each entry: what shipped, what changed from the plan, what we learned.

### Unreleased
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
