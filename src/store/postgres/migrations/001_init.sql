-- 001_init: the SQLite schema (store/sqlite/migrations) in Postgres terms.
-- Differences: aliases and tags are text[] columns on nodes, JSON is jsonb,
-- seq keeps insertion order, and search is a weighted tsvector kept by a trigger.
-- Timestamps stay ISO text so both stores compare and sort them the same way.
-- schema_migrations is created by the runner itself, before any file runs.

-- SEARCH CONFIG -----------------------------------------------------
-- English stemming with no stop words, like SQLite's porter tokenizer.
CREATE TEXT SEARCH DICTIONARY mcpdia_stem (TEMPLATE = snowball, LANGUAGE = english);
CREATE TEXT SEARCH CONFIGURATION mcpdia (COPY = english);
ALTER TEXT SEARCH CONFIGURATION mcpdia ALTER MAPPING REPLACE english_stem WITH mcpdia_stem;

-- NODES -------------------------------------------------------------
CREATE TABLE nodes (
  seq              bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id               text PRIMARY KEY,                 -- ULID
  namespace        text NOT NULL DEFAULT 'default',
  key              text NOT NULL,
  type             text NOT NULL,
  title            text NOT NULL,
  summary          text,
  body             text,
  properties       jsonb NOT NULL DEFAULT '{}',
  aliases          text[] NOT NULL DEFAULT '{}',     -- stored normalized, sorted
  tags             text[] NOT NULL DEFAULT '{}',     -- sorted

  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','superseded','deleted')),
  superseded_by    text REFERENCES nodes(id),
  version          integer NOT NULL DEFAULT 1,

  source           text NOT NULL DEFAULT 'local',
  author           text NOT NULL DEFAULT 'local',
  updated_by       text NOT NULL DEFAULT 'local',
  created_at       text NOT NULL,
  updated_at       text NOT NULL,
  last_verified_at text,

  useful_count     integer NOT NULL DEFAULT 0,
  not_useful_count integer NOT NULL DEFAULT 0,
  wrong_count      integer NOT NULL DEFAULT 0,
  last_useful_at   text,
  last_wrong_at    text,

  search           tsvector NOT NULL DEFAULT ''::tsvector,

  UNIQUE (namespace, key)
);
CREATE INDEX idx_nodes_type     ON nodes(namespace, type, status);
CREATE INDEX idx_nodes_updated  ON nodes(namespace, updated_at);
CREATE INDEX idx_nodes_verified ON nodes(last_verified_at);
CREATE INDEX idx_nodes_tags     ON nodes USING gin (tags);
CREATE INDEX idx_nodes_search   ON nodes USING gin (search);

-- Weights: title A, summary and aliases B, tags C, body D.
CREATE FUNCTION nodes_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search :=
    setweight(to_tsvector('mcpdia', NEW.title), 'A') ||
    setweight(to_tsvector('mcpdia', coalesce(NEW.summary, '') || ' ' || array_to_string(NEW.aliases, ' ')), 'B') ||
    setweight(to_tsvector('mcpdia', array_to_string(NEW.tags, ' ')), 'C') ||
    setweight(to_tsvector('mcpdia', coalesce(NEW.body, '')), 'D');
  RETURN NEW;
END $$;

CREATE TRIGGER nodes_search BEFORE INSERT OR UPDATE OF title, summary, body, aliases, tags ON nodes
  FOR EACH ROW EXECUTE FUNCTION nodes_search();

-- EDGES (late-bound, ADR 0007) --------------------------------------
CREATE TABLE edges (
  seq            bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id             text PRIMARY KEY,                   -- ULID
  from_namespace text NOT NULL,
  from_key       text NOT NULL,
  to_namespace   text NOT NULL,
  to_key         text NOT NULL,
  from_id    text REFERENCES nodes(id),              -- NULL = not loaded (a "ghost")
  to_id      text REFERENCES nodes(id),
  type       text NOT NULL,
  note       text,
  properties jsonb NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','deleted')),
  version    integer NOT NULL DEFAULT 1,
  source     text NOT NULL DEFAULT 'local',
  author     text NOT NULL DEFAULT 'local',
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX idx_edges_unique
  ON edges(from_namespace, from_key, to_namespace, to_key, type) WHERE status = 'active';
CREATE INDEX idx_edges_from ON edges(from_id, type, status);
CREATE INDEX idx_edges_to   ON edges(to_id,   type, status);
CREATE INDEX idx_edges_to_ref   ON edges(to_namespace,   to_key)   WHERE to_id IS NULL;
CREATE INDEX idx_edges_from_ref ON edges(from_namespace, from_key) WHERE from_id IS NULL;

-- HISTORY -----------------------------------------------------------
CREATE TABLE node_versions (
  node_id     text NOT NULL REFERENCES nodes(id),
  version     integer NOT NULL,
  snapshot    jsonb NOT NULL,
  body_len    integer NOT NULL DEFAULT 0,
  change_type text NOT NULL,                         -- create|update|merge|supersede|delete|restore
  changed_by  text NOT NULL,
  changed_at  text NOT NULL,
  PRIMARY KEY (node_id, version)
);

-- OPTIONAL TYPE DEFINITIONS ----------------------------------------
CREATE TABLE type_defs (
  kind                 text NOT NULL CHECK (kind IN ('node','edge')),
  name                 text NOT NULL,
  namespace            text NOT NULL DEFAULT 'default',
  description          text,
  suggested_properties jsonb,
  expected_edges       jsonb,
  source               text NOT NULL DEFAULT 'local',
  updated_at           text NOT NULL,
  PRIMARY KEY (kind, name, namespace)
);

-- SETTINGS ----------------------------------------------------------
CREATE TABLE settings (
  namespace  text NOT NULL DEFAULT 'default',
  scope      text NOT NULL,                          -- 'pack:<name>' | 'team' | 'user:<id>'
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY (namespace, scope, key)
);
