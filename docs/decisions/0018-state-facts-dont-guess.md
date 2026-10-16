# 0018: State facts, don't guess

- Status: Accepted
- Date: 2026-10-16
- Amends: ADR 0002 (the "did you mean?" hint)

## Context
Several results guessed what the caller meant: a new type got "Did you mean ticket?", an unknown filter got the closest type, a missing key got the nearest key. The guesses come from string distance, so they are sometimes wrong (restoring a node of type `test` suggested `task`), and a model tends to take a named option at face value. The caller is a model that can look things up itself in one call.

## Decision
**Results state what the server knows and where to look, and never name a guess.**
- A new node or edge type: `Type "tickets" is new here. list_types shows the types in use.` Starter types and types already in use get no line.
- A `search` type filter no node has: `No nodes have type "conept". list_types shows the types in use.`
- A missing key in `get`: `Not found: concept/permision. search finds nodes by their words.`

Writes still never block (ADR 0002). `list_types` still points out types that differ only by a plural or a separator, since those are facts about the graph rather than guesses about the caller.

## Alternatives considered
- **Keep guesses, tune the distance.** Still wrong some of the time, and a wrong guess reads as an answer.
- **Drop the new-type line too.** Loses the drift guard ADR 0002 relies on; the fact alone is enough to prompt a check.

## Consequences
Hints stay accurate. A model that misspells a type or key spends one `list_types` or `search` call to find the right one.
