// Reads a whole MCPdia graph into the JSON shape the viewer uses. Shared by export-graph and serve.
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultDbPath = () => process.env.MCPDIA_DB ?? join(homedir(), '.mcpdia', 'mcpdia.db');

// Read-only: the viewer never writes to the graph.
export const openGraph = (dbPath) => new Database(dbPath, { readonly: true, fileMustExist: true });

export function readGraph(db) {
  const nodes = db
    .prepare(
      `SELECT namespace, key, type, title, summary, body, properties, status, updated_at
       FROM nodes WHERE status != 'deleted'`,
    )
    .all()
    .map((n) => ({ ...n, id: `${n.namespace}:${n.key}`, properties: JSON.parse(n.properties || '{}') }));

  const edges = db
    .prepare(
      `SELECT from_namespace, from_key, to_namespace, to_key, type, note
       FROM edges WHERE status != 'deleted'`,
    )
    .all()
    .map((e) => ({
      from: `${e.from_namespace}:${e.from_key}`,
      to: `${e.to_namespace}:${e.to_key}`,
      type: e.type,
      note: e.note,
    }));

  // Legend text comes from the graph's own type definitions when they exist.
  const typeDefs = db.prepare(`SELECT kind, name, description FROM type_defs`).all();

  // Pinned "start here" nodes (the orient tool's list), from every scope's `pinned` setting.
  const pinned = new Set();
  for (const { namespace, value } of db.prepare(`SELECT namespace, value FROM settings WHERE key = 'pinned'`).all()) {
    for (const ref of JSON.parse(value)) pinned.add(qualify(ref, namespace));
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

// Changes whenever another connection (the MCP server) commits to the database.
export const dataVersion = (db) => db.pragma('data_version', { simple: true });
