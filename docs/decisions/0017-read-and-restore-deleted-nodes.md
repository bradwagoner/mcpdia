# 0017: Read and restore deleted nodes

- Status: Accepted
- Date: 2026-10-16

## Context
`delete` is a soft delete: the node and its history stay in the store. But no tool could read a deleted node afterwards, and `upsert` refused its key with "Use a different key". A delete couldn't be checked or undone through MCPedia, and a deleted key was taken for good.

## Decision
**`get` and `search` take `all_status: true` to return deleted and superseded nodes, and `upsert` on a deleted key restores that node.**

- Reads are unchanged by default. With the flag, each node is marked: `(deleted)` or `(superseded by <key>)` on its title line, and at `full` a line saying when it was deleted and how to restore it.
- `upsert` on a deleted key edits the node with what was passed and sets it active again: same id, same history, new versions. Fields not passed keep their old values, and the result says `Restored <key>`.
- A superseded key still refuses writes and names its replacement, since the replacement holds the current facts.
- Links pointing at a restored key work again, because edges store the key, not the node (ADR 0007).

## Alternatives considered
- **Start a fresh node on the deleted key.** Two nodes would share one key's history, and old links would quietly point at new content.
- **A separate `restore` tool.** Another tool description every session pays for, for something `upsert` can say in its result.
- **Keep refusing, but explain how to restore.** Leaves the key stuck unless the caller learns a second step.
- **One flag per status** (`include: ["deleted"]`). More to explain; `all_status` matches `export --all-status`.

## Consequences
Deletes can be checked and undone with the tools a model already uses. A model that writes to a key it doesn't know was deleted gets the old node back, and the result tells it so. `recent` and `orient` still show active nodes only.
