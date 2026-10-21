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

## Features

- Twelve tools over stdio: `orient`, `search`, `get`, `upsert`, `annotate`, `link`, `supersede`, `verify`, `delete`, `feedback`, `recent` and `list_types` ([reference](docs/tools.md))
- A local SQLite store with full-text search, ready to use with no setup
- Free-form node and edge types: a new type is pointed out, never blocked
- A tiny, configurable `orient` tool as the welcome mat for a new session
- Tools load on demand in Claude Code: until the model needs MCPdia, a session carries only its tool names
- JSONL export of the whole graph
- A per-call metrics log, to see where a session's tokens went
- A read-only [graph viewer](viewer/README.md) for browsing what your LLMs have written
- CI on Linux, macOS and Windows, with Node 22 and 24

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

### Export

```bash
node dist/index.js export --out graph.jsonl
```

This writes active nodes and their links. Add `--namespace ns` to pick namespaces, or `--all-status` to include superseded and deleted nodes. The format is in [`docs/schema.md`](docs/schema.md#jsonl-export-format).

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

MCPdia feeds stored text back to LLMs, so treat what it returns as data, not instructions: a node can inform an agent, never authorize it. It runs locally over stdio against a SQLite file on your machine, with no network port. Details in [SECURITY.md](SECURITY.md).

## Roadmap

- **v0.2, cleanup and packs:** duplicate and stale-node finders, bulk merges and renames with dry runs, JSONL import, and seeding a graph from a document or repo.
- **v0.3, team mode:** one shared graph for a whole team, with Postgres, HTTP transport, a Docker image and token auth.

The full plan and release diary are in [`docs/SCOPE.md`](docs/SCOPE.md).

## Design

Every significant choice is written down with its reasoning:

- [Decision records](docs/decisions/README.md)
- [Schema](docs/schema.md)
- [Scope and release diary](docs/SCOPE.md)

## License

[MIT](LICENSE)
