# 0008: Intent-named tools and separate note nodes

- Status: Accepted
- Date: 2026-10-06

## Context
An LLM is the main writer. Two questions came up:

1. If two users want to make distinct comments about the same ticket, do their edits mesh, or collide?
2. How do we keep the LLM from bloating a shared node by appending notes to it, without making the tools complicated?

## Decision

**Users are not part of the key.** The key says which thing a node is; who wrote about it doesn't change that. Putting the user in the key would create duplicate nodes per author and make merging datasets much harder.

**Shared facts live in the node; observations live in linked note nodes.**
- The ticket is one node (`ticket/PROJ-123`) holding what the team agrees on.
- Each person's comment is its own node of type `note`, with a generated key, the author stamped on it, and a `comments_on` edge to the ticket.
- Two people editing the same node are protected by the `version` check (the second save is told the node changed). Notes never collide because each is a separate node.
- Private notes use a personal namespace (for example `user:alice`) and can still link to shared nodes.

**Tools are named for intent, and the core handles the bookkeeping.**
- `annotate(on, text)` creates the note node, key, author, and edge in one call, and leaves the target's body and version untouched.
- `supersede` creates or updates the replacement, marks the old node superseded with a pointer, and re-points its edges.
- `verify` bumps `last_verified_at`.
- `upsert` is for creating or editing a node's own facts.

**Guidance lives in tool descriptions and orient text, not in write-time enforcement.** One line in each: "notes and observations go in linked nodes; edit a node's body only to correct shared facts." No size limits or growth warnings on writes, which keeps writes simple.

**Mistakes are fixed by detection and cleanup, not prevented.** Pruner/cleanup prompts should prioritize **recently edited nodes**. A node whose body grew substantially since its previous version (for example +50%) carries extra weight as a candidate to flag or split. Growth is measured from `node_versions.body_len`, so no new tracking is required. Because of soft delete and versioning, any split or revert is reversible.

**Tool count has no fixed cap.** Each tool covers one distinct intent with a short description. Tool descriptions are loaded every session and overlapping tools make selection less reliable, so we avoid near-duplicates rather than limiting the number.

## Alternatives considered
- **Generic create/update/delete with many optional parameters:** the LLM has to know the structure behind a "note". More ways to get it wrong.
- **User as part of the node key:** duplicate nodes and harder merges.
- **Write-time growth warnings or size limits:** more moving parts, and the cleanup pass catches the same problem anyway.

## Consequences
- The common path (leave a note on something) is one call and cheaper than editing a body, so it is the path of least resistance.
- Some bloated nodes will still appear. The README should say so plainly: guardrails reduce the mess and cleanup tooling handles the rest.
- Every intent-named tool adds a description to the session context, so each one needs to justify its existence.
