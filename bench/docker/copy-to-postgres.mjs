// Copies a SQLite graph into an empty Postgres one, row for row, for benchmarking
// the two stores on the same data. Run it inside the mcpdia container (it has pg and
// better-sqlite3): node /app/copy-to-postgres.mjs /tmp/graph.db
// The Postgres schema must exist already: the server creates it on first start.
import Database from 'better-sqlite3';
import pg from 'pg';

const [file] = process.argv.slice(2);
const url = process.env.MCPDIA_DATABASE_URL;
if (!file || !url) throw new Error('Usage: MCPDIA_DATABASE_URL=postgres://… node copy-to-postgres.mjs graph.db');

const lite = new Database(file, { readonly: true });
const client = new pg.Client({ connectionString: url });
await client.connect();

const all = (sql) => lite.prepare(sql).all();
const listOf = (sql) => {
  const map = new Map();
  for (const { node_id, v } of all(sql)) map.set(node_id, [...(map.get(node_id) ?? []), v]);
  for (const list of map.values()) list.sort();
  return map;
};
const aliases = listOf('SELECT node_id, alias AS v FROM node_aliases');
const tags = listOf('SELECT node_id, tag AS v FROM node_tags');

async function insert(table, row) {
  const cols = Object.keys(row);
  await client.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
}

const [{ n }] = (await client.query('SELECT count(*)::int AS n FROM nodes')).rows;
if (n > 0) throw new Error(`Postgres already has ${n} nodes; copy into an empty graph only.`);

await client.query('BEGIN');
// Insertion order (rowid) becomes seq. superseded_by points at later rows, so it is set afterwards.
const nodes = all('SELECT * FROM nodes ORDER BY rowid');
for (const { superseded_by, ...row } of nodes) {
  await insert('nodes', { ...row, aliases: aliases.get(row.id) ?? [], tags: tags.get(row.id) ?? [] });
}
for (const { id, superseded_by } of nodes) {
  if (superseded_by) await client.query('UPDATE nodes SET superseded_by = $1 WHERE id = $2', [superseded_by, id]);
}
const edges = all('SELECT * FROM edges ORDER BY rowid');
for (const row of edges) await insert('edges', row);
const versions = all('SELECT * FROM node_versions');
for (const row of versions) await insert('node_versions', row);
for (const row of all('SELECT * FROM type_defs')) await insert('type_defs', row);
for (const row of all('SELECT * FROM settings')) await insert('settings', row);
await client.query('COMMIT');

console.log(`Copied ${nodes.length} nodes, ${edges.length} edges, ${versions.length} versions.`);
await client.end();
