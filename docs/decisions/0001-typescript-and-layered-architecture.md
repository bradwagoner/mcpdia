# 0001: TypeScript and a three-layer architecture

- Status: Accepted
- Date: 2026-10-06

## Context
The project is an LLM-facing glossary backed by a knowledge graph, exposed over MCP. It must work for a solo user with zero setup, and later for a team running it on shared infrastructure. The same logic has to serve both.

## Decision
Build in **TypeScript**, in three layers:

1. **MCP tools:** thin adapters. No business logic.
2. **Core:** the rules (search-before-write, dedupe, type normalization, versioning, render levels). Knows nothing about MCP or about how data is stored.
3. **GraphStore:** an async storage interface. SQLite is the first implementation, Postgres the second.

Every core call receives a `context` object (who is calling, which namespace). In solo mode it is a constant; in team mode it is populated from auth.

## Alternatives considered
- **Python + FastMCP:** pleasant and has strong stdlib SQLite support, but the MCP ecosystem and `npx`-style one-line install favor TypeScript, and the main Python advantage (ML/embeddings) is optional and phase 2 here.
- **A single script with logic inline:** quickest to write, but it couples storage, rules, and transport, which makes the team deployment a rewrite.

## Consequences
- Storage can be swapped without touching tools or rules. One test suite can run against both stores.
- Adding a REST API or CLI later is a new adapter, not a refactor.
- Async everywhere, even where SQLite doesn't need it, because network-backed stores do.
- Slightly more structure up front than a single script.
