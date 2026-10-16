# 0015: Links on create, and a hint for nodes with no parent

- Status: Accepted
- Date: 2026-10-15

## Context
In real use, many tasks and issues ended up at the top level of the graph with nothing above them. Creating a node and linking it under its parent are two calls (`upsert`, then `link`), and models often skip the second one. Tool descriptions are read once per session and fade; a tool result arrives while the model is paying attention.

## Decision
**`upsert` takes `links`.** `links: [{type, to, note?}]` writes edges from the node in the same call. It is a shortcut for `upsert` followed by `link` for each entry, with the same rules: targets may not exist yet (ADR 0007), and on update links are only added, never replaced or removed. Every link is checked before the node is written.

**A hint, not a block.** When `upsert` creates a node of any type and none of its links is a parent edge (`part_of`, `comments_on`, `candidate_for`), the result says so in one line. The line names no candidate parent: a guess from recent writes was often wrong in testing, and the model reading the hint can search if it needs one. The write always succeeds (ADR 0002). Most nodes belong under something, so the hint covers every type; when a new root really is new, the model just moves on.

## Alternatives considered
- **An "are you sure?" round trip** before creating a parentless node: costs a call every time, and models learn to answer yes without thinking.
- **Guessing a parent from the title or text:** presumptuous, and a wrong guess written into the graph is worse than no link.
- **Instructions only** (tool descriptions, orient): already in place, and not enough on their own.

## Consequences
One call can now place a node where it belongs. The hint costs no extra reads and about 30 tokens when it fires. The parent edge types are a fixed list in `src/core/vocabulary.ts` for now; making them settings can come later if graphs need different ones.
