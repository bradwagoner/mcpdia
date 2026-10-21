# Tool contracts

What each MCP tool takes and returns. Responses are compact text (ADR 0011); render levels are from ADR 0004. Keys are shown bare while one namespace is visible (`concept/permissions`) and qualified with several (`dev:concept/permissions`). Inputs accept either form, or a node's ULID.

| Level | One result looks like |
|---|---|
| `title` | `concept/permissions [concept] Permission system` |
| `summary` | + next line: `  Roles grant actions; groups hold roles. · 4 links · verified 2026-09-30` |
| `snippet` | + the first 300 characters of the body. In `search`, if a searched word only appears past that, about 100 characters of intro, ` … `, the text around the word, and `(+N chars)` (ADR 0020) |
| `full` | + whole body, tags, aliases, properties, version, updated date |

Reads show active nodes. A superseded node fetched directly says so at every level: `(superseded by <key>)` on its title line, `Superseded by <key>` at `full`. `feedback` accepts superseded nodes; `verify` and `delete` skip them and name the replacement. Deleted nodes are left out of reads, and a tool asked for one by key says `<key> was deleted.` rather than not found. `get` and `search` take `all_status: true` to include deleted and superseded nodes, marked `(deleted)` or `(superseded by <key>)`; writing to a deleted key with `upsert` restores it (ADR 0017).

A node marked `outdated_or_wrong` shows `(flagged outdated or wrong)` on its title line, and at `full` a line saying when and what to do. The flag clears when someone edits or verifies the node.

Tool results add a one-line hint when the tool knows something the caller would want: a dangling link, a loop, a property that was dropped (ADR 0016). Each hint states the fact and the next step, and none of them block the call.

## orient
"Call first. Explains this knowledge graph, its house rules and where to start. Pass a few focus words about your task to get likely-relevant entries."

| Input | Type | Default | Notes |
|---|---|---|---|
| `focus` | string | none | Adds up to 5 title-level matches. |

The preset (`minimal`, `standard`, `verbose`), intro, house rules and pinned keys come from settings (`orient`, `house_rules`, `pinned`), not from the call. An empty graph says `The graph is empty. Use upsert to add the first node.`

## search
"Keyword search over titles, summaries, bodies, aliases and tags. Returns short stubs; use get for detail."

| Input | Type | Default | Notes |
|---|---|---|---|
| `query` | string | required | Plain words; matches word stems. Question words (what, is, how, the...) are dropped. Every word must match; if nothing does, any word may, and the header says `No node matched all words`. |
| `type` | string | any | Normalized like writes. A type no node has gets `No nodes have type "conept". list_types shows the types in use.` |
| `tag` | string | any | A miss with filters names them, so you can retry without. |
| `level` | render level | `summary` | |
| `limit` | 1 to 50 | 10 | |
| `all_status` | boolean | false | Include superseded and deleted nodes. |

Ranked by FTS5 relevance (title weighs most), with at most a 10% boost for nodes marked useful.

```
3 of 7 results for "permissions":
- concept/permissions [concept] Permission system
  Roles grant actions; groups hold roles. · 4 links · verified 2026-09-30
- ...
4 more: raise limit or add type.
```

When no node matches every word, the results are partial matches and the header says so:

```
No node matched all words of "permission billing". 1 partial match; check it before relying on it:
- concept/permissions [concept] Permission system (matched: permission)
```

When fewer nodes match every word than the limit, partial matches fill the rest, after the full ones (ADR 0021):

```
1 result for "billing roles", then 2 partial matches; check them before relying on them:
- concept/billing-roles [concept] Billing roles
- concept/roles [concept] Roles (matched: roles)
- concept/permissions [concept] Permission system (matched: roles)
```

## get
"Fetch one or more nodes by key. Optionally include directly linked nodes as titles."

| Input | Type | Default | Notes |
|---|---|---|---|
| `keys` | list of keys | required | Up to `get.max_keys` (default 10). |
| `level` | render level | `full` | |
| `neighbors` | boolean | false | Adds nodes one link away. |
| `neighbor_level` | render level | `title` | |
| `all_status` | boolean | false | Return deleted nodes too; at `full` they say when they were deleted. |

Neighbors are grouped by direction and edge type, capped at 20 with a `+N more` line. A link to a node that does not exist yet shows `(missing)`. Several nodes are separated by `---`.

```
concept/permissions [concept] Permission system   v3 · updated 2026-10-01 · verified 2026-09-30
Roles grant actions; groups hold roles.
Tags: auth, core   Aliases: perms, access control

A user's effective permissions are the union of the roles on every group they belong to...

Links:
→ depends_on: concept/roles Roles; concept/groups Groups
→ references: concept/audit-log (missing)
```

Not found: `Not found: concept/permision. search finds nodes by their words.` A deleted node: `concept/roles was deleted; all_status: true shows it.`

## upsert
"Create a node, or edit a node's own facts by key. Search first to avoid duplicates. Keep one thing per node; put it under its parent with links."

| Input | Type | Notes |
|---|---|---|
| `key` | string | Omit to create; the key is built from type and title (ADR 0012). A deleted node's key restores that node (ADR 0017). |
| `type`, `title` | string | Required. |
| `summary`, `body` | string | |
| `tags`, `aliases` | list of strings | Replace the current lists when passed. |
| `properties` | object | Replaces the current properties when passed. |
| `version` | integer | Apply only if the node is still at this version. |
| `links` | list of `{type, to, note?}` | Edges from this node, written in the same call, like `link`. Added, never replaced. |

Returns `Created concept/permissions (v1).`, `Updated ... (v2).` or `Restored ... (v5).`, plus `Type "tickets" is new here. list_types shows the types in use.` when no node has the type yet and it isn't a starter type, and a line per link. A new node with no parent link gets one more line saying so (ADR 0015), and a new node with no summary gets one too, since search shows the summary. An update that drops properties names them: `Properties replaced; dropped status, order. Pass every property you want to keep.`

## link
"Link two nodes with a typed edge, e.g. depends_on, part_of, references, related_to. The target may not exist yet."

| Input | Type | Notes |
|---|---|---|
| `from`, `to` | key | `from` must exist; `to` may be created later (ADR 0007). |
| `type` | string | Normalized to `snake_case`. |
| `note` | string | Short reason for the link. |

Linking the same pair with the same type again updates the note. Returns `Linked: concept/a → depends_on → concept/b.` One more line when the edge type is new to the graph, when the target was deleted (the link leads nowhere), is superseded (names the current node), or when a parent edge (`part_of`, `comments_on`, `candidate_for`) would make a loop.

## annotate
"Leave a note or observation about a node. Saved as its own linked note; the node itself is unchanged. Prefer this to editing a node's body."

| Input | Type | Notes |
|---|---|---|
| `on` | key | The node the note is about. Must be active. |
| `text` | string | The note. |
| `title` | string | Defaults to the first line of text, cut at 80 characters. |

Creates a `note` node keyed from its title (`note/cache-is-5-min`, or `-2`, `-3` on a clash) with a `comments_on` edge to the target. The target's body and version do not change (ADR 0008). Returns `Noted note/cache-is-5-min on concept/permissions.`

## supersede
"Replace an outdated node with a new one. Moves its links to the replacement and keeps the old one as history."

| Input | Type | Notes |
|---|---|---|
| `old` | key | The node being replaced. Must be active. |
| `new` | key | The replacement, existing or new. Omit to build a key from type and title. |
| `type`, `title` | string | Default to the old node's. |
| `summary`, `body`, `tags`, `aliases` | | As in `upsert`. |

The old node becomes `superseded` and points at the replacement. Its links move to the replacement; a link that would duplicate one already there, or join the two nodes to each other, is soft-deleted instead. A `supersedes` edge from the replacement to the old node keeps the history visible. Returns `concept/access-model (new) supersedes concept/permissions. Moved 2 links.`

## verify, delete, feedback
All three take `keys` (up to 50) and report keys they could not find, or that were already deleted, on further lines.

- **verify:** "Mark nodes as checked and still correct." Sets the verified date; does not create a version.
- **delete:** "Remove nodes from reads. History is kept. If something replaces the node, use supersede instead." Soft delete only. Lists the live nodes that still link to a deleted one, since those links now lead nowhere; notes about it are left out.
- **feedback:** "Say which nodes helped." Takes `verdict`: `useful`, `not_useful` or `outdated_or_wrong`. Counters live on the node; `useful` also gives a small search boost and shows in `recent` (ADR 0005).

## recent
"Latest changes and nodes marked useful, newest first."

| Input | Type | Default | Notes |
|---|---|---|---|
| `mine` | boolean | false | Only nodes the caller wrote last. |
| `since` | string | none | A date (`2026-10-01`) or a span (`3d`, `12h`, `2w`). |
| `limit` | 1 to 50 | 10 | |

```
- concept/permissions [concept] Permission system · marked useful 2026-10-07
- note/cache-is-5-min [note] Cache is 5 min · created 2026-10-07
```

Reads are not tracked (ADR 0004). An empty result names its filters: `Nothing recent (since 3d, yours only).`

## list_types
"Node and edge types in use, with counts. Check before inventing a new type."

```
Node types: concept 12, how-to 4, note 3
Edge types: depends_on 9, comments_on 3
Also available: decision, related_to, part_of, supersedes, example_of, references
```

Types that differ only by a plural or a separator get one more line: `Look alike: concept and concepts. Pick one and reuse it.`
