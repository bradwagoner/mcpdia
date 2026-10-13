# 0004: Render levels and a lean, configurable `orient`

- Status: Accepted
- Date: 2026-10-06

## Context
The project exists to save tokens. The original problem was reading whole markdown files to find one fact. Anything that returns more than the caller needs defeats the purpose, and the LLM needs a cheap way to scan, then dig into only what looks promising.

## Decision
**Render levels** are a single enum used by every read tool (search, get, traversal, recent, orient's pinned list):

| Level     | Returns                                                    |
|-----------|------------------------------------------------------------|
| `title`   | key, type, title                                           |
| `summary` | title + one-line summary, edge count, last verified        |
| `snippet` | title + first N characters of the body                     |
| `full`    | everything: body, properties, aliases                      |

Defaults: `summary` for search results, `title` for neighbors, `full` for a direct get by key. Traversal has a separate setting for neighbors.

**`orient`** is the welcome mat, and it stays small (a few hundred tokens at most by default):
- two or three lines on what this is and the loop (search, read stubs, expand, write back, then call `feedback`)
- team-written house rules, if any
- counts, plus the top handful of types as names only
- pinned "start here" nodes, titles only
- one line pointing to `list_types`, `recent`, and `search`
- optional `focus` keywords that append a few title-only "possibly relevant" results

`orient` is a **recipe of sections** stored as settings data, layered: built-in defaults, then pack, then team, then personal. Each section picks a render level. Presets (`minimal`, `standard`, `verbose`) cover most users.

`recent` is a separate tool with filters (author, namespace, since). It tracks writes and useful-marked nodes. It does **not** track reads.

## Alternatives considered
- **Token budget:** unpredictable output and hard to reason about. Render levels are explicit.
- **Listing all types by default:** costs tokens every session for little value.
- **Recent nodes inside `orient`:** most likely to be noise.
- **Read tracking:** measures curiosity, and every read would become a write.

## Consequences
- Callers can predict cost. The cheap path is the default path.
- Teams customize onboarding without code changes, and packs can ship their own recipe.
- The server cannot see the user's window or conversation, so `focus` keywords must be supplied by the LLM.
