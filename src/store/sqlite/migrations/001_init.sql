-- 001_init: the schema from docs/schema.md, plus FTS5 search.
-- schema_migrations is created by the runner itself, before any file runs.

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

  source           TEXT NOT NULL DEFAULT 'local',
  author           TEXT NOT NULL DEFAULT 'local',
  updated_by       TEXT NOT NULL DEFAULT 'local',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_verified_at TEXT,

  useful_count     INTEGER NOT NULL DEFAULT 0,
  not_useful_count INTEGER NOT NULL DEFAULT 0,
  wrong_count      INTEGER NOT NULL DEFAULT 0,
  last_useful_at   TEXT,

  UNIQUE (namespace, key)
);
CREATE INDEX idx_nodes_type      ON nodes(namespace, type, status);
CREATE INDEX idx_nodes_updated   ON nodes(namespace, updated_at);
CREATE INDEX idx_nodes_verified  ON nodes(last_verified_at);

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

-- EDGES (late-bound, ADR 0007) --------------------------------------
CREATE TABLE edges (
  id             TEXT PRIMARY KEY,                   -- ULID
  from_namespace TEXT NOT NULL,
  from_key       TEXT NOT NULL,
  to_namespace   TEXT NOT NULL,
  to_key         TEXT NOT NULL,
  from_id    TEXT REFERENCES nodes(id),              -- NULL = not loaded (a "ghost")
  to_id      TEXT REFERENCES nodes(id),
  type       TEXT NOT NULL,
  note       TEXT,
  properties TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','deleted')),
  version    INTEGER NOT NULL DEFAULT 1,
  source     TEXT NOT NULL DEFAULT 'local',
  author     TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_edges_unique
  ON edges(from_namespace, from_key, to_namespace, to_key, type) WHERE status = 'active';
CREATE INDEX idx_edges_from ON edges(from_id, type, status);
CREATE INDEX idx_edges_to   ON edges(to_id,   type, status);
CREATE INDEX idx_edges_to_ref   ON edges(to_namespace,   to_key)   WHERE to_id IS NULL;
CREATE INDEX idx_edges_from_ref ON edges(from_namespace, from_key) WHERE from_id IS NULL;

-- HISTORY -----------------------------------------------------------
-- One row per version: the snapshot is the node as it stood at that version.
CREATE TABLE node_versions (
  node_id     TEXT NOT NULL REFERENCES nodes(id),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  body_len    INTEGER NOT NULL DEFAULT 0,
  change_type TEXT NOT NULL,                         -- create|update|merge|supersede|delete|restore
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL,
  PRIMARY KEY (node_id, version)
);

-- OPTIONAL TYPE DEFINITIONS ----------------------------------------
CREATE TABLE type_defs (
  kind                 TEXT NOT NULL CHECK (kind IN ('node','edge')),
  name                 TEXT NOT NULL,
  namespace            TEXT NOT NULL DEFAULT 'default',
  description          TEXT,
  suggested_properties TEXT,
  expected_edges       TEXT,
  source               TEXT NOT NULL DEFAULT 'local',
  updated_at           TEXT NOT NULL,
  PRIMARY KEY (kind, name, namespace)
);

-- SETTINGS ----------------------------------------------------------
CREATE TABLE settings (
  namespace  TEXT NOT NULL DEFAULT 'default',
  scope      TEXT NOT NULL,                          -- 'pack:<name>' | 'team' | 'user:<id>'
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,                          -- JSON
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, scope, key)
);

-- FULL-TEXT SEARCH --------------------------------------------------
-- One FTS row per node, keyed by the node's rowid. Aliases and tags are
-- flattened into space-separated columns. Triggers keep it in sync.
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  title, summary, body, aliases, tags,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts (rowid, title, summary, body, aliases, tags)
  VALUES (new.rowid, new.title, coalesce(new.summary, ''), coalesce(new.body, ''), '', '');
END;

CREATE TRIGGER nodes_fts_update AFTER UPDATE OF title, summary, body ON nodes BEGIN
  UPDATE nodes_fts
     SET title = new.title, summary = coalesce(new.summary, ''), body = coalesce(new.body, '')
   WHERE rowid = new.rowid;
END;

CREATE TRIGGER node_aliases_fts_insert AFTER INSERT ON node_aliases BEGIN
  UPDATE nodes_fts
     SET aliases = (SELECT group_concat(alias, ' ') FROM node_aliases WHERE node_id = new.node_id)
   WHERE rowid = (SELECT rowid FROM nodes WHERE id = new.node_id);
END;

CREATE TRIGGER node_aliases_fts_delete AFTER DELETE ON node_aliases BEGIN
  UPDATE nodes_fts
     SET aliases = coalesce((SELECT group_concat(alias, ' ') FROM node_aliases WHERE node_id = old.node_id), '')
   WHERE rowid = (SELECT rowid FROM nodes WHERE id = old.node_id);
END;

CREATE TRIGGER node_tags_fts_insert AFTER INSERT ON node_tags BEGIN
  UPDATE nodes_fts
     SET tags = (SELECT group_concat(tag, ' ') FROM node_tags WHERE node_id = new.node_id)
   WHERE rowid = (SELECT rowid FROM nodes WHERE id = new.node_id);
END;

CREATE TRIGGER node_tags_fts_delete AFTER DELETE ON node_tags BEGIN
  UPDATE nodes_fts
     SET tags = coalesce((SELECT group_concat(tag, ' ') FROM node_tags WHERE node_id = old.node_id), '')
   WHERE rowid = (SELECT rowid FROM nodes WHERE id = old.node_id);
END;
