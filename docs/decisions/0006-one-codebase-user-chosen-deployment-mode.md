# 0006: One codebase, user-chosen deployment mode

- Status: Accepted
- Date: 2026-10-06

## Context
This is a free, open-source project. A solo developer should be able to try it in minutes to save tokens. If it proves useful, they should be able to take the same project to their team and run it on company infrastructure (for example AWS) without switching tools.

## Decision
One codebase, three modes, chosen by the user:

- **Solo:** local SQLite file, stdio MCP transport, starts empty.
- **Solo + seed:** same, but a pack (file or remote URL) is imported at setup. If the remote does not exist, start empty.
- **Team:** the same core behind an HTTP server in Docker, backed by Postgres, deployable to cloud infrastructure.

Central server is the team model. Peer-to-peer sync between independent instances is explicitly out of scope: merge conflicts, identity, and trust make it far harder than the benefit justifies. Import/export of packs covers most "share a subset" needs.

Authentication and permissions are phase 2, but core calls already take a `context` object (caller, namespace) so they can be added without changing call signatures.

## Alternatives considered
- **Solo-only first, retrofit teams later:** risks architectural corners (see 0001, 0003).
- **Federated sync:** rejected as above.
- **DynamoDB or other key-value stores for team mode:** poor fit for graph traversal and text search. MySQL works but has no advantage over Postgres here.

## Consequences
- Two storage adapters to maintain, kept honest by running one shared test suite against both.
- Optimistic concurrency (`version` column: "update only if still version N") is built in now and matters once there are multiple writers.
- Docker quickstart and a documented AWS deployment path are required for the team story.
