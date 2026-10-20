// Export an MCPdia SQLite graph to the JSON the viewer reads. Opens the database read-only.
// Usage (from viewer/): node scripts/export-graph.mjs [path/to/mcpdia.db] [www/data/mcpdia.json]
// Uses better-sqlite3 from the repo root, so run `npm install` at the root first.
// The JSONL export (#3) will replace this script as the viewer's file data source.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultDbPath, openGraph, readGraph } from './read-graph.mjs';

const dbPath = process.argv[2] ?? defaultDbPath();
const outPath = process.argv[3] ?? 'www/data/mcpdia.json';

const db = openGraph(dbPath);
const graph = readGraph(db);
db.close();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ source: dbPath, ...graph }));
console.log(
  `Wrote ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.typeDefs.length} type defs to ${outPath}`,
);
