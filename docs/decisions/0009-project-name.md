# 0009: Project name

- Status: Accepted
- Date: 2026-10-06

## Context
The project needs a name that is memorable, hints at what it is, and works in a repo, a package name, and a portfolio. We considered Cairn, Mycelium, Knot, Gnode, Noted, Lexigraph, and several descriptive names. **MCPedia** (MCP plus encyclopedia) won because it says what the project is in one word.

A search of the Glama MCP directory found an existing, unrelated project also called MCPedia: a Markdown-first knowledge base with PostgreSQL full-text search and an MCP server, published under an `@mcpedia` package scope. It is in a similar niche.

## Decision
Use **MCPedia** anyway.

- The GitHub repo lives under the author's own account, so there is no repository collision.
- Publish to npm under the author's own scope, not `@mcpedia`.
- Host the project page under the author's personal domain (`<domain>/mcpedia`) rather than buying a name-specific domain.
- The README carries a distinctive tagline. It no longer has a "not affiliated" note (removed 2026-10-14 to keep the front page focused); this record is the place for that context.

## Alternatives considered
- **Cairn / `cairn-mcp`:** best story, but it needs a tagline to explain what it is.
- **Gnode, Noted, Knot, Lexigraph:** fine options, held in reserve.
- **mcpedia.com:** listed for thousands of dollars; not worth buying for a portfolio project.

## Consequences
- Some risk of confusion with the other project, especially in search results and on npm.
- The name is cheap to change early. If confusion proves to be a real problem, revisit before the first public release; a rename is a repo setting plus find-and-replace.
- Conflict checks so far covered the Glama directory only. GitHub and npm should be checked directly before publishing.
