# MCPdia

[![CI](https://github.com/bradwagoner/mcpdia/actions/workflows/ci.yml/badge.svg)](https://github.com/bradwagoner/mcpdia/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Model Context Protocol: Distilled, Indexed Answers.** Long-term memory for LLMs, stored as a knowledge graph and served over MCP.

Tell your LLM "remember this" once, and have it find the answer later without re-reading whole files. MCPdia stores what you know as linked nodes, hands the model small summaries first, and lets it decide what is worth reading in full. The model does the filing too: it writes, links and corrects nodes as it works.

## The result

Same questions, same facts, fresh Claude sessions, three ways to keep memory:

| Memory | Tasks done right | Cost per session |
|---|---|---|
| **MCPdia** | **20/20** | **$0.0027** |
| One `CLAUDE.md` with everything in it | 20/20 | $0.0049 |
| A `CLAUDE.md` index plus hand-split topic files | 19/20 | $0.0022 |

**Every task right, at 44% less cost than one big memory file.** Hand-split markdown comes close on cost, but someone has to keep that index and those topic files in order. With MCPdia, the model files what it learns as it goes.

Method: Claude Haiku 5.5, ten read and write tasks against a fictional product team's knowledge (82 facts), each run twice, every session starting from a fresh copy. Run it yourself from [`bench/sessions`](bench/sessions/README.md); every session's pass, cost and tokens are in [`sessions.csv`](bench/sessions/data/sessions.csv).

## How it works

- **Stubs first.** `search` returns one line per node (title, summary, or the snippet around the match), so the model reads a few hundred tokens instead of a whole file.
- **Read only what matters.** `get` loads a node at the level it needs: `title`, `summary`, `snippet` or `full`.
- **Follow the links.** Nodes link to their parents and to each other, so related facts are one hop away.
- **Write back as you go.** `upsert`, `annotate`, `link`, `supersede` and `verify` are named for what the model is trying to do; the server does the bookkeeping.
- **Nothing is lost.** Every edit is versioned, deletes are soft, and a superseded node points to its replacement.
- **Learn what helps.** `feedback` marks nodes useful, not useful or wrong, and search flags nodes marked wrong.

## See what your LLM knows

<!-- Screenshot 1 (hero): docs/images/viewer-tree.png, concept/mcpdia selected with its family tree around it -->

Memory you can look at. The graph viewer opens your graph in the browser: every node your LLMs have written, linked the way they linked it, updating live while they work.

- **Click any node** and its family tree gathers around it: parents above, children below, siblings beside, and every other link grouped by type at the sides.
- **Search as you type**, then hide everything unrelated to focus on one corner of the graph.
- **Read it all** in the detail panel: summary, full text, properties and every connection, each one a link.
- **Watch it grow.** New nodes appear next to their neighbors as your LLM writes them, and your selection, search and camera stay put.
- **Fast on big graphs:** WebGL rendering with Sigma.js, tested at 10,000 nodes. Prefer Cytoscape.js? It's one dropdown away.

<!-- Screenshot 2: docs/images/viewer-search.png, a search with Hide unrelated ticked and the detail panel open -->

```bash
cd viewer
npm install
npm start
```

That's your graph, live and read-only, at http://localhost:8000. With Docker it's already running at http://localhost:7412. Add `-- --lan` to browse it from your phone. More in the [viewer guide](viewer/README.md).

## Features

- Twelve tools over stdio or HTTP: `orient`, `search`, `get`, `upsert`, `annotate`, `link`, `supersede`, `verify`, `delete`, `feedback`, `recent` and `list_types` ([reference](docs/tools.md))
- A local SQLite store with full-text search, ready to use with no setup
- One shared graph for a whole team: Postgres and HTTP in a single `docker compose up`
- Free-form node and edge types: a new type is pointed out, never blocked
- A tiny, configurable `orient` tool as the welcome mat for a new session
- Tools load on demand in Claude Code: until the model needs MCPdia, a session carries only its tool names
- JSONL export of the whole graph, and starter sets: exports loaded next to your own graph at startup, with your edits kept and conflicts flagged
- A per-call metrics log, to see where a session's tokens went
- A read-only [graph viewer](viewer/README.md) for browsing what your LLMs have written
- CI on Linux, macOS and Windows, with Node 22 and 24

## How it scales

Measured with the repo's own benches on a Windows desktop. No model is involved, so they cost nothing to rerun.

**Answers stay findable.** 40 questions about a demo project, with the answers hidden among generated nodes on other topics (`npm run bench:lookups`):

| Nodes | Answer in the top 3 | Search p50 / p95 | Get p50 |
| --- | --- | --- | --- |
| 82 | 39/40 | 2.0 / 3.3 ms | 0.1 ms |
| 1,082 | 40/40 | 2.3 / 3.9 ms | 0.1 ms |
| 10,082 | 39/40 | 9.6 / 22 ms | 0.2 ms |
| 100,082 | 38/40 | 339 / 755 ms | 0.2 ms |

**The cost of an answer stays flat.** Reading one answer from MCPdia takes about 660 tokens whether the memory holds 82 facts or 1,600. Loading the same memory as one markdown file grows from 15,000 to 250,000 tokens (`npm run bench:growth`).

**SQLite or Postgres.** Both stores find the same nodes: 177 and 176 of 177 in the top 3 on a real graph. SQLite is quickest for one person; Postgres keeps up when many clients share a big graph. Both Docker stacks on one machine, over HTTP, with a real 177-node graph and then with 10,000 more nodes (`npm run bench:stores`):

| | SQLite | Postgres | SQLite +10k | Postgres +10k |
| --- | --- | --- | --- | --- |
| Search, 1 client, p50 | 32 ms | 39 ms | 81 ms | 121 ms |
| Get, 1 client, p50 | 15 ms | 15 ms | 15 ms | 15 ms |
| 16 clients, 1 write in 4 | 144 calls/s | 56 calls/s | 23 calls/s | 77 calls/s |

Your numbers will differ with your machine; the shape holds.

## Install

Needs Node 22 or later. No build tools: the SQLite driver ships prebuilt.

```bash
git clone https://github.com/bradwagoner/mcpdia.git
cd mcpdia
npm install
npm run build
```

Register it with Claude Code:

```bash
claude mcp add mcpdia -- node /path/to/mcpdia/dist/index.js
```

The graph lives in `~/.mcpdia/mcpdia.db`. Set `MCPDIA_DB` to keep it somewhere else.

### Run it in Docker

```bash
docker compose up -d
claude mcp add --transport http mcpdia http://localhost:7411/mcp
```

That's MCPdia on Postgres, serving every client from one graph, with the live graph viewer at http://localhost:7412. Prefer a single SQLite file? `docker compose -f docker-compose.sqlite.yml up -d`. Settings are in [`docs/docker.md`](docs/docker.md).

### Export

```bash
node dist/index.js export --out graph.jsonl
```

This writes active nodes and their links. Add `--namespace ns` to pick namespaces, `--tag tag` to keep only tagged nodes and the links between them, or `--all-status` to include superseded and deleted nodes. The format is in [`docs/schema.md`](docs/schema.md#jsonl-export-format).

### Starter sets

Start with a graph that already knows things. A starter set is an export that loads into its own namespace whenever the server starts, next to your own graph:

```bash
claude mcp add mcpdia -e MCPDIA_STARTERS=team=http://localhost:7411/export,mcpdia=mcpdia-starter.jsonl -- node /path/to/mcpdia/dist/index.js
```

One search covers your notes and every set, and your notes can link into them (`team:concept/billing`). Edit anything: untouched nodes follow the source, your edits stay, and if the source changed a node you edited too, you get a conflict node to review, listed at load and marked on the node. The `resolve-conflicts` prompt walks through them. Leave a set out of the list and it's gone from view at the next start. A relative file path is read from the database's folder (`~/.mcpdia`), since the client may start the server anywhere. Sharing a set with someone? Have them list it under the same name, so your links to `mcpdia:concept/...` resolve on their side too; your exports carry only your own graph, never the sets you loaded. Cut a set from any graph with `export --tag`, or load one by hand with `mcpdia seed set.jsonl --namespace name`. More in [ADR 0026](docs/decisions/0026-starter-sets-on-startup.md).

### Measure it yourself

Set `MCPDIA_METRICS=1` and every tool call adds one line to `mcpdia-metrics.jsonl` next to your database:

```json
{"ts":"2026-10-19T15:40:02.114Z","session":"01K7…","tool":"search","ms":4,"ok":true,"req_chars":38,"res_chars":912,"level":"summary"}
```

Each line is something the server measured: no estimates, no query text, no node content. Pair it with Claude's own usage report (`claude -p --output-format json`) to see where a session's tokens went, request by request.

```bash
claude mcp add mcpdia -e MCPDIA_METRICS=1 -- node /path/to/mcpdia/dist/index.js
```

## Security

MCPdia feeds stored text back to LLMs, so treat what it returns as data, not instructions: a node can inform an agent, never authorize it. By default it runs locally over stdio against a SQLite file on your machine, with no network port. The HTTP server answers on localhost only. Details in [SECURITY.md](SECURITY.md).

## Roadmap

- **v0.2, cleanup and packs:** duplicate and stale-node finders, bulk merges and renames with dry runs, JSONL import, and seeding a graph from a document or repo.
- **v0.3, team mode:** Postgres, HTTP and the Docker image are in. Next come token auth, per-namespace permissions and a documented AWS deployment.

The full plan and release diary are in [`docs/SCOPE.md`](docs/SCOPE.md).

## Design

Every significant choice is written down with its reasoning:

- [Decision records](docs/decisions/README.md)
- [Schema](docs/schema.md)
- [Scope and release diary](docs/SCOPE.md)

## License

[MIT](LICENSE)
