# Decision Records

Short records of the significant design decisions in this project: what we chose, why, and what we gave up. They are written at the time of the decision and not rewritten later. If a decision changes, we add a new record that supersedes the old one.

| #    | Decision                                              | Status   |
|------|-------------------------------------------------------|----------|
| 0001 | TypeScript and a three-layer architecture             | Accepted |
| 0002 | Free-form types with soft guardrails                  | Accepted, amended by 0018 |
| 0003 | Stable keys, namespaces, and portable packs           | Accepted |
| 0004 | Render levels and a lean, configurable `orient`       | Accepted, amended by 0020 |
| 0005 | Usefulness feedback as a separate tool                | Accepted |
| 0006 | One codebase, user-chosen deployment mode             | Accepted |
| 0007 | Late-bound edges and ghost nodes                      | Accepted |
| 0008 | Intent-named tools and separate note nodes            | Accepted |
| 0009 | Project name                                          | Superseded by 0022 |
| 0010 | SQLite library: better-sqlite3                        | Accepted |
| 0011 | Compact text responses                                | Accepted |
| 0012 | Readable keys and normalization rules                 | Accepted |
| 0013 | Benchmark method                                      | Superseded by 0023 |
| 0014 | Graph viewer library: Sigma.js or Cytoscape.js | Accepted |
| 0015 | Links on create, and a hint for nodes with no parent | Accepted |
| 0016 | Tools say what happened                               | Accepted |
| 0017 | Read and restore deleted nodes                        | Accepted |
| 0018 | State facts, don't guess                              | Accepted |
| 0019 | Per-call metrics log                                  | Accepted |
| 0020 | Snippets show the match                               | Accepted |
| 0021 | Search tops up short results with partial matches     | Accepted |
| 0022 | Project name: MCPdia                                  | Accepted |
| 0023 | The headline comes from live sessions                 | Accepted |
| 0024 | Lookup tests without a model                          | Proposed |
| 0025 | Postgres store, HTTP transport and a Docker image     | Proposed |
| 0026 | Starter sets loaded on startup                        | Accepted |

## Template

```markdown
# NNNN: Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What problem are we solving, and what constraints apply?

## Decision
What we chose.

## Alternatives considered
What else we looked at and why we passed.

## Consequences
What gets easier, what gets harder, what we are deliberately deferring.
```
