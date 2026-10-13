# Schema (first pass)

Status: **draft for discussion.** Written in SQLite dialect. The Postgres adapter will map types (`TEXT` timestamps to `timestamptz`, JSON text to `jsonb`) but keeps the same shape. This would become `migrations/001_init.sql`.

## Conventions

- **IDs:** ULID strings. Internal references only.
- **Timestamps:** ISO 8601 UTC text.
- **JSON:** stored as text, validated in core.
- **Defaults** for `namespace`, `source`, and `author` are `'default'`, `'local'`, and `'local'`, so solo mode needs no setup but team mode has somewhere to put real values.
- **Nothing is hard-deleted** in normal operation. See `status`.

## Tables

```sql
-- NODES -------------------------------------------------------------
CREATE TABLE nodes (
  id               TEXT PRIMARY KEY,                 -- ULID
  namespace        TEXT NOT NULL DEFAULT 'default',
  key              TEXT NOT NULL,                    -- stable, cross-graph identity
  type             TEXT NOT NULL,                    -- free-form, normalized on write
  title            TEXT NOT NULL,
  summary          TEXT,                             -- one line; what search/traversal return
  body             TEXT,                             -- long form; only returned at snippet/full
  properties       TEXT NOT NULL DEFAULT '{}',       -- JSON, free-form

  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','superseded','deleted')),
  superseded_by    TEXT REFERENCES nodes(id),
  version          INTEGER NOT NULL DEFAULT 1,       -- optimistic concurrency

  source           TEXT NOT NULL DEFAULT 'local',    -- pack/origin; enables clean removal
  author           TEXT NOT NULL DEFAULT 'local',    -- created by
  updated_by       TEXT NOT NULL DEFAULT 'local',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_verified_at TEXT,                             -- staleness signal

  useful_count     INTEGER NOT NULL DEFAULT 0,       -- from feedback tool
  not_useful_count INTEGER NOT NULL DEFAULT 0,
  wrong_count      INTEGER NOT NULL DEFAULT 0,
  last_useful_at   TEXT,

  UNIQUE (namespace, key)
);
CREATE INDEX idx_nodes_type      ON nodes(namespace, type, status);
CREATE INDEX idx_nodes_updated   ON nodes(namespace, updated_at);
CREATE INDEX idx_nodes_verified  ON nodes(last_verified_at);

-- Aliases and tags are separate tables so they are indexable
-- (duplicate detection looks aliases up; filters look tags up).
CREATE TABLE node_aliases (
  node_id TEXT NOT NULL REFERENCES nodes(id),
  alias   TEXT NOT NULL,                             -- stored normalized
  PRIMARY KEY (node_id, alias)
);
CREATE INDEX idx_aliases_alias ON node_aliases(alias);

CREATE TABLE node_tags (
  node_id TEXT NOT NULL REFERENCES nodes(id),
  tag     TEXT NOT NULL,
  PRIMARY KEY (node_id, tag)
);
CREATE INDEX idx_tags_tag ON node_tags(tag);

-- EDGES -------------------------------------------------------------
CREATE TABLE edges (
  id         TEXT PRIMARY KEY,                       -- ULID
  -- Late-bound reference: the real identity of each end (ADR 0007)
  from_namespace TEXT NOT NULL,
  from_key       TEXT NOT NULL,
  to_namespace   TEXT NOT NULL,
  to_key         TEXT NOT NULL,
  -- Resolved shortcuts, filled in when the node is loaded. NULL = not loaded (a "ghost").
  from_id    TEXT REFERENCES nodes(id),
  to_id      TEXT REFERENCES nodes(id),
  type       TEXT NOT NULL,                          -- free-form, normalized
  note       TEXT,                                   -- short human/LLM explanation
  properties TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','deleted')),
  version    INTEGER NOT NULL DEFAULT 1,
  source     TEXT NOT NULL DEFAULT 'local',
  author     TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- one active edge per (from, to, type); re-linking is an upsert
CREATE UNIQUE INDEX idx_edges_unique
  ON edges(from_namespace, from_key, to_namespace, to_key, type) WHERE status = 'active';
-- fast reads via resolved ids
CREATE INDEX idx_edges_from ON edges(from_id, type, status);
CREATE INDEX idx_edges_to   ON edges(to_id,   type, status);
-- used to resolve waiting edges when a node is created or imported
CREATE INDEX idx_edges_to_ref   ON edges(to_namespace,   to_key)   WHERE to_id IS NULL;
CREATE INDEX idx_edges_from_ref ON edges(from_namespace, from_key) WHERE from_id IS NULL;

-- HISTORY -----------------------------------------------------------
-- Snapshot of a node before each change. Makes cleanup passes reversible
-- and gives an audit trail. (Edges rely on soft delete only.)
CREATE TABLE node_versions (
  node_id     TEXT NOT NULL REFERENCES nodes(id),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,                         -- JSON of the full row
  body_len    INTEGER NOT NULL DEFAULT 0,            -- body size at this version; lets cleanup
                                                     -- measure growth without parsing JSON
  change_type TEXT NOT NULL,                         -- create|update|merge|supersede|delete|restore
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL,
  PRIMARY KEY (node_id, version)
);

-- TYPE DEFINITIONS (optional) ---------------------------------------
-- Usage counts are NOT stored here; they are computed from nodes/edges.
-- A type with no row here is perfectly valid.
CREATE TABLE type_defs (
  kind                TEXT NOT NULL CHECK (kind IN ('node','edge')),
  name                TEXT NOT NULL,
  namespace           TEXT NOT NULL DEFAULT 'default',
  description         TEXT,
  suggested_properties TEXT,                         -- JSON
  expected_edges      TEXT,                          -- JSON (node types only)
  source              TEXT NOT NULL DEFAULT 'local',
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (kind, name, namespace)
);

-- SETTINGS ----------------------------------------------------------
-- Orient recipe, house rules, pinned nodes, defaults.
-- Layering at read time: built-in -> pack -> team -> user.
CREATE TABLE settings (
  namespace  TEXT NOT NULL DEFAULT 'default',
  scope      TEXT NOT NULL,                          -- 'pack:<name>' | 'team' | 'user:<id>'
  key        TEXT NOT NULL,                          -- e.g. 'orient', 'house_rules'
  value      TEXT NOT NULL,                          -- JSON
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, scope, key)
);

-- MIGRATIONS --------------------------------------------------------
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

### Full-text search (SQLite adapter only)

Search is a method on `GraphStore`, so its implementation is private to each adapter. In SQLite it is an FTS5 virtual table over title, summary, body, aliases, and tags, kept in sync by triggers. In Postgres it becomes a generated `tsvector` column with a GIN index. Nothing above the store layer depends on either.

### JSONL export format

`mcpedia export [--namespace ns]... [--out file]` writes the graph as JSON Lines (stdout when `--out` is omitted). It is store-agnostic: the core builds it from `GraphStore.listNodes` and `listEdges`, and v0.2 import reads it back.

1. One `header` line: `{"kind":"header","format":"mcpedia-jsonl","version":1,"exportedAt","namespaces","nodes","edges"}`.
2. One `node` line per node in the namespaces, **any status**, oldest first, so supersede chains and soft deletes survive. Fields are the node record in camelCase (`id`, `namespace`, `key`, `type`, `title`, `summary`, `body`, `properties`, `aliases`, `tags`, `status`, `supersededBy`, `version`, `source`, `author`, `updatedBy`, `createdAt`, `updatedAt`, `lastVerifiedAt`, feedback counters).
3. One `edge` line per **active** edge whose source is in the namespaces: `fromNamespace`, `fromKey`, `toNamespace`, `toKey`, the nullable resolved ids, `type`, `note`, `version`, `author`, timestamps.

Nodes come before edges so an importer can create them first. Importers should match on `(namespace, key)`, not on `id` (ADR 0003). `node_versions` history is not exported yet.

### Reserved for later (not in `001_init`)

```sql
-- v0.4+: optional embeddings. Table may be empty; never required.
CREATE TABLE node_embeddings (
  node_id      TEXT NOT NULL REFERENCES nodes(id),
  model        TEXT NOT NULL,
  content_hash TEXT NOT NULL,   -- re-embed only when content changes
  vector       BLOB NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (node_id, model)
);
```

## Why these choices

| Choice | Reason |
|---|---|
| `key` separate from `id` | Merging and packs need identity that survives across graphs (ADR 0003). |
| `summary` vs `body` | Summary is what search and traversal return; body is only paid for on demand (ADR 0004). |
| Aliases/tags as tables | Duplicate detection and filtering need indexed lookups, which JSON arrays don't give. |
| `properties` as JSON | Keeps the schema fluid; users describe their data without migrations (ADR 0002). |
| `status` + `superseded_by` + `node_versions` | Reversible cleanup, undo, and audit; "supersede" beats "delete" in a shared graph. |
| `version` | Optimistic concurrency: an update says "apply only if still version N". |
| Feedback counters on the node | Cheap, soft signal; no event log to maintain (ADR 0005). |
| `type_defs` optional | Types exist because nodes use them; definitions are documentation, never enforcement. |
| `settings` table | One mechanism for orient recipe, house rules, and pins, with built-in/pack/team/user layering. |
| Edges store namespace + key for both ends; ids are nullable | Edges can exist before, or without, their target being loaded: partial loads, import ordering, and cross-namespace links all work (ADR 0007). |
| `body_len` on `node_versions` | Cleanup passes can flag recently edited nodes and weight those that grew sharply (ADR 0008). |

## Open questions

1. **Cross-namespace edges: resolved (ADR 0007).** Edges are late-bound, so an edge into an unloaded namespace is stored normally and the read handles it (phase 2: returns a "ghost" reference instead of failing).
2. **Edge identity in packs: resolved.** Edges match on `(from_namespace, from_key, to_namespace, to_key, type)`, which is exactly the unique index. No separate edge key needed.
3. **Pinned nodes.** Currently a `settings` value (list of keys). Should pins instead be a reserved edge type or tag so they are visible in the graph itself?
4. **Tag normalization.** Same rules as types, or looser?
5. **Body size.** Do we want a soft limit (and a hint to split long bodies into linked nodes)? Large bodies undercut the token-saving goal.
