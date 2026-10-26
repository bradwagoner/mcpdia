// Reads a whole MCPdia graph into the JSON shape the viewer uses. Shared by export-graph and serve.
// The source is a SQLite file, or a postgres:// URL for the Postgres store (Docker, ADR 0025).
import Database from 'better-sqlite3';
import pg from 'pg';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultSource = () =>
  process.env.MCPDIA_DATABASE_URL ?? process.env.MCPDIA_DB ?? join(homedir(), '.mcpdia', 'mcpdia.db');

const isPostgres = (source) => /^postgres(ql)?:\/\//.test(source);

/** Where the graph is, for display. A Postgres password is never shown. */
export function describeSource(source) {
  if (!isPostgres(source)) return source;
  const url = new URL(source);
  if (url.password) url.password = '***';
  return url.toString();
}

/**
 * Opens the graph read-only: the viewer never writes to it. Returns
 * { read(): graph, version(): string, close() }, all async.
 */
export async function openGraph(source) {
  return isPostgres(source) ? openPostgres(source) : openSqlite(source);
}

function openSqlite(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const all = (sql) => db.prepare(sql).all();
  return {
    read: async () => buildGraph(all, (s) => JSON.parse(s || '{}')),
    // Changes whenever another connection (the MCP server) commits to the database.
    version: async () => String(db.pragma('data_version', { simple: true })),
    close: async () => db.close(),
  };
}

async function openPostgres(url) {
  // Every transaction read-only, so a bug here can't change the graph.
  const pool = new pg.Pool({ connectionString: url, max: 2, options: '-c default_transaction_read_only=on' });
  pool.on('error', (err) => console.error(`postgres: ${err.message}`));
  // Read the whole graph in one snapshot, so nodes and edges agree.
  const read = async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const rows = new Map();
      for (const sql of QUERIES) rows.set(sql, (await client.query(sql)).rows);
      await client.query('COMMIT');
      return buildGraph(
        (sql) => rows.get(sql),
        (v) => v ?? {},
      );
    } finally {
      client.release();
    }
  };
  return {
    read,
    // Postgres has no commit counter, so this sums up what any write touches.
    version: async () => (await pool.query(PG_VERSION)).rows[0].v,
    close: () => pool.end(),
  };
}

const NODES = `SELECT namespace, key, type, title, summary, body, properties, status, updated_at
  FROM nodes WHERE status != 'deleted'`;
const EDGES = `SELECT from_namespace, from_key, to_namespace, to_key, type, note FROM edges WHERE status != 'deleted'`;
const TYPE_DEFS = `SELECT kind, name, description FROM type_defs`;
const PINNED = `SELECT namespace, value FROM settings WHERE key = 'pinned'`;
const QUERIES = [NODES, EDGES, TYPE_DEFS, PINNED];

const PG_VERSION = `SELECT concat_ws(':',
  (SELECT count(*) || '.' || coalesce(max(greatest(updated_at, last_useful_at, last_verified_at, last_wrong_at)), '')
          || '.' || coalesce(sum(useful_count + not_useful_count + wrong_count), 0) FROM nodes),
  (SELECT count(*) || '.' || coalesce(max(updated_at), '') FROM edges),
  (SELECT count(*) || '.' || coalesce(max(updated_at), '') FROM settings),
  (SELECT count(*) FROM type_defs)) AS v`;

/** `all(sql)` returns the rows for one of QUERIES; `json` turns a stored JSON value into an object. */
function buildGraph(all, json) {
  const nodes = all(NODES).map((n) => ({ ...n, id: `${n.namespace}:${n.key}`, properties: json(n.properties) }));

  const edges = all(EDGES).map((e) => ({
    from: `${e.from_namespace}:${e.from_key}`,
    to: `${e.to_namespace}:${e.to_key}`,
    type: e.type,
    note: e.note,
  }));

  // Legend text comes from the graph's own type definitions when they exist.
  const typeDefs = all(TYPE_DEFS);

  // Pinned "start here" nodes (the orient tool's list), from every scope's `pinned` setting.
  const pinned = new Set();
  for (const { namespace, value } of all(PINNED)) {
    for (const ref of json(value)) pinned.add(qualify(ref, namespace));
  }
  return { typeDefs, nodes, edges, pinned: [...pinned] };
}

// A pinned ref as `namespace:key`. A bare key belongs to the setting's own namespace.
// Like parseRef in src/core/keys.ts, the namespace ends at the last colon before the first slash.
function qualify(ref, namespace) {
  const slash = ref.indexOf('/');
  const colon = (slash === -1 ? ref : ref.slice(0, slash)).lastIndexOf(':');
  return colon > 0 ? ref : `${namespace}:${ref}`;
}
