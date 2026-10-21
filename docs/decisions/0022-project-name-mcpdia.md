# 0022: Project name: MCPdia

- Status: Accepted
- Date: 2026-10-20
- Supersedes: 0009

## Context
ADR 0009 kept the name MCPedia despite an unrelated project with the same name in the same niche, and said to revisit before the first public release if that looked like a problem. With the release close, sharing a name in search results and on npm is a cost with no upside.

## Decision
The project is **MCPdia**, short for **Model Context Protocol: Distilled, Indexed Answers**.

- The repository is `bradwagoner/mcpdia`; the old URL redirects.
- The npm package is `@bradwagoner/mcpdia` and the command is `mcpdia`.
- The README, docs, server name, `orient` text and viewer use the new name.
- Runtime names follow: `MCPDIA_DB`, `MCPDIA_METRICS`, the `~/.mcpdia/mcpdia.db` default, the `mcpdia-metrics.jsonl` log and the `mcpdia-jsonl` export format id. There is no fallback to the old names: nothing has been published, so the only existing setup moves by hand.
- Older decision records keep the name they were written with.

## Alternatives considered
- **Keep MCPedia:** no work, but it keeps the collision ADR 0009 flagged.
- **Keep the old runtime names, or read both:** no move needed, but a fallback is code to carry for a setup that exists only on the author's machine.

## Consequences
- A distinct name in search results and on npm. GitHub and npm should still be checked for `mcpdia` before publishing.
- An existing graph moves by renaming `~/.mcpedia` to `~/.mcpdia` and `mcpedia.db` to `mcpdia.db`, then re-registering the server as `mcpdia`, which renames its tools to `mcp__mcpdia__*`.
