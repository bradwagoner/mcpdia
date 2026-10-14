# MCPedia

**Shared glossary and knowledge-graph memory for LLMs, over MCP.**

Tell your LLM "remember this" once, and have it (and your teammates' LLMs) find it later without re-reading whole files. MCPedia stores what you know as a graph of linked nodes, returns small summaries first, and lets the model decide what to dig into.

> **Status:** in development. v0.1 is nearly complete: all twelve tools work over stdio with a local SQLite store. Nothing is published to npm yet. See [`docs/SCOPE.md`](docs/SCOPE.md) for the plan.

## Why

Keeping LLM memory in markdown files costs tokens: the model has to read a big file to find one fact. MCPedia returns title-level or summary-level stubs, follows links between nodes, and only loads full content for what looks promising.

<!-- TODO: headline benchmark result once the harness exists, e.g. "Same task, N% fewer tokens than markdown memory files." -->

## Features

- Free-form node and edge types, with soft "did you mean?" guardrails (cleanup tooling is planned for v0.2)
- Render levels (`title`, `summary`, `snippet`, `full`) on every read
- A tiny, configurable `orient` tool as the welcome mat for connecting LLMs
- Notes as linked nodes, usefulness feedback, and versioned, reversible edits
- Solo mode with a local SQLite store (team mode with Postgres in Docker is planned for v0.3)

## Try it (development)

Needs Node 22 or later.

```bash
npm install
npm run build
npm test
npm run format:check
```

Register the local build with Claude Code (the database defaults to `~/.mcpedia/mcpedia.db`; set `MCPEDIA_DB` to move it):

```bash
claude mcp add mcpedia -- node /path/to/mcpedia/dist/index.js
```

The tools are `orient`, `search`, `get`, `upsert`, `annotate`, `link`, `supersede`, `verify`, `delete`, `feedback`, `recent` and `list_types`. Their inputs and outputs are in [`docs/tools.md`](docs/tools.md).

## Design

The reasoning behind each choice is written down:

- [Decision records](docs/decisions/README.md)
- [Schema](docs/schema.md)
- [Scope and release diary](docs/SCOPE.md)

## License

[MIT](LICENSE)
