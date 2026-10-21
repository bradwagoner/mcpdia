# 0019: Per-call metrics log

- Status: Accepted
- Date: 2026-10-19

## Context
The benchmark (ADR 0013) and the side-by-side demo (#24) compare what a session costs with MCPedia, with markdown memory and with none. Token counts and cost come from Claude's own usage reports (`claude -p --output-format json`), which the server cannot see. What only the server sees is each tool call: which tool, how long it took, and how much text went in and out. Without that, a session total can't be split by request.

## Decision
**An opt-in log of raw facts about each tool call, as JSON Lines in a file next to the database.**
- Off by default. `MCPEDIA_METRICS=1` turns it on. When it is off, nothing is written.
- The file is `mcpedia-metrics.jsonl` in the same folder as the database (`MCPEDIA_DB`), so a copied or throwaway graph keeps its own log.
- One line per call: `ts`, `session` (a ULID per server start), `tool`, `ms`, `ok`, `req_chars`, `res_chars`, and `level` when the call has one.
- Stored values are what the server measured. No token estimates, no query text, no node content.
- `req_chars` is the length of the arguments as JSON, after the input schema fills in defaults. A call the SDK rejects before it reaches the tool (bad arguments) is not logged.
- One wrapper around tool registration in `src/server.ts` records every call; tool bodies are unchanged.
- A failed write is reported once on stderr and never fails the tool call.

Analysis lives in the bench: it joins this log with Claude's usage output to report fixed cost, read and write cost, growth, break-even, session totals and correctness.

## Alternatives considered
- **A table in the SQLite file plus a `mcpedia stats` command.** Built once (#23, first cut) and backed out: it needs a migration and store methods for data that is never queried by the tools, and every reader then needs SQLite.
- **CSV.** Opens in a spreadsheet, but a new field changes every line's shape; JSON Lines lets old and new lines sit in one file.
- **Token counts per call.** Exact counts need a network call per request; estimates are not raw data.

## Consequences
Anyone can measure MCPedia on their own graph with one environment variable. The log grows without bound while it is on; delete the file to start over. Retention and a readout command can come later if people ask.
