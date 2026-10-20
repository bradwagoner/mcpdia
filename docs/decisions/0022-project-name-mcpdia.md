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
- Runtime names stay as they are for now: the `MCPEDIA_DB` and `MCPEDIA_METRICS` variables, the `~/.mcpedia` folder, the `mcpedia-metrics.jsonl` log and the `mcpedia-jsonl` export format id. Renaming them would break existing graphs, logs and exports, so it needs a fallback to the old names and gets its own decision.
- Older decision records keep the name they were written with.

## Alternatives considered
- **Keep MCPedia:** no work, but it keeps the collision ADR 0009 flagged.
- **Rename everything at once, runtime names included:** consistent, but every existing setup would lose its graph until moved by hand.

## Consequences
- A distinct name in search results and on npm. GitHub and npm should still be checked for `mcpdia` before publishing.
- Until the runtime names follow, the README shows `MCPEDIA_*` variables next to the MCPdia name.
