# 0003: Stable keys, namespaces, and portable packs

- Status: Accepted
- Date: 2026-10-06

## Context
We want to avoid painting ourselves into a corner for phase 2 features: importing curated subsets ("packs"), merging datasets, promoting personal notes into a shared graph, and seeding from a remote. Those only work if two graphs can tell that two rows describe the same thing.

## Decision
- **IDs** are ULIDs: globally unique, sortable by creation time. Used for internal references only.
- Every node has a **stable key** (e.g. `concept/permission-system`), unique within a namespace. Keys are the identity used across graphs.
- Every row carries **namespace**, **source** (which pack or origin it came from), **author**, timestamps, and a **version** integer, populated with defaults like `local` in solo mode.
- **Soft delete** via `status` (`active` | `superseded` | `deleted`). Hard deletes are never part of normal operation.
- A **portable export format** (JSONL of nodes, edges, type definitions, and settings) is a first-class feature. Import means: read the format, match on `(namespace, key)`, apply a conflict policy (skip, overwrite, keep both).
- **Namespaces are the subset mechanism:** connecting with only the `dev` namespace loaded needs no extra machinery. `source` lets a pack be removed cleanly.

## Alternatives considered
- **Auto-increment integer IDs:** collide across instances; merging becomes painful.
- **Content hashing for identity:** breaks when text is edited.

## Consequences
- The columns exist from day one even though import, merge, and auth ship later. Adding them afterwards would need a migration plus backfilling meaning that no longer exists.
- Authors must choose good keys. The core suggests keys from titles and checks for collisions.
- Conflict resolution policy for imports is deferred to phase 2.
