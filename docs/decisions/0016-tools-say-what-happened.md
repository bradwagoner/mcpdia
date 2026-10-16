# 0016: Tools say what happened

- Status: Accepted
- Date: 2026-10-16

## Context
Every tool result lands in a model's context while it is deciding what to do next. In testing, several results stayed quiet about things the server already knew: a search that matched no node fully, a node another agent had marked wrong, a delete that left links pointing at nothing, a typo in a filter that looked like an empty graph. The model then acted on a wrong picture, or spent calls finding out.

## Decision
**When a tool knows something the caller would want, the result says it in one line: the fact, then the next step.** Hints never block the call (ADR 0002) and only appear when they apply, so normal results stay as short as before (ADR 0004, 0011).

The hints in place:
- `search`: partial matches are labelled, with the words each hit matched; an unknown `type` gets a "did you mean"; a miss with filters names them.
- `get` and `search`: a node marked `outdated_or_wrong` is flagged until someone edits or verifies it. This needs `last_wrong_at` on nodes (migration 002); the counters alone can't tell an old complaint from a current one.
- Any tool given a deleted key says it was deleted, not that it doesn't exist.
- `delete`: lists live nodes that still link to what was deleted.
- `link`: warns when the target is deleted or superseded, or when a parent edge would make a loop.
- `upsert`: a new node without a summary, an update that dropped properties, and a new node with no parent (ADR 0015).
- `recent` and `list_types`: an empty result names its filters; lookalike types are pointed out.

## Alternatives considered
- **Put the guidance in tool descriptions.** They load every session whether or not the case comes up, and models stop noticing them.
- **Return errors instead.** Blocks writes that are often fine (a node with no summary yet) and goes against ADR 0002.
- **Structured warning fields.** Clients would need to know to show them; a plain line works with every client.

## Consequences
Models get a more accurate picture for a few extra tokens, only when something is off. New tools follow the same rule. A partial search runs one extra query per word to label matches, which is cheap on a local SQLite file.
