// Export an MCPdia graph to the JSON the viewer reads. Opens the database read-only.
// Usage (from viewer/): node scripts/export-graph.mjs [path/to/mcpdia.db | postgres://…] [www/data/mcpdia.json]
// Uses better-sqlite3 from the repo root, so run `npm install` at the root first.
// The JSONL export (#3) will replace this script as the viewer's file data source.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultSource, describeSource, openGraph } from './read-graph.mjs';

const source = process.argv[2] ?? defaultSource();
const outPath = process.argv[3] ?? 'www/data/mcpdia.json';

const db = await openGraph(source);
const graph = await db.read();
await db.close();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ source: describeSource(source), ...graph }));
console.log(
  `Wrote ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.typeDefs.length} type defs to ${outPath}`,
);
