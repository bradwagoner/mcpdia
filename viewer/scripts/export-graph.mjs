// Export an MCPdia graph to the JSON the viewer reads. Opens the database read-only.
// Usage (from viewer/): node scripts/export-graph.mjs [path/to/mcpdia.db | postgres://…] [www/data/mcpdia.json]
//                        add --select=namespace:key to open the snapshot on that node
// Uses better-sqlite3 from the repo root, so run `npm install` at the root first.
// The JSONL export (#3) will replace this script as the viewer's file data source.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultSource, describeSource, openGraph } from './read-graph.mjs';

const args = process.argv.slice(2);
const [sourceArg, outArg] = args.filter((a) => !a.startsWith('--'));
const source = sourceArg ?? defaultSource();
const outPath = outArg ?? 'www/data/mcpdia.json';
const selected = args.find((a) => a.startsWith('--select='))?.slice('--select='.length);

const db = await openGraph(source);
const graph = await db.read();
await db.close();
if (selected && !graph.nodes.some((n) => n.id === selected)) {
  throw new Error(`--select ${selected}: no such node. Ids look like default:concept/billing.`);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ source: describeSource(source), selected, ...graph }));
console.log(
  `Wrote ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.typeDefs.length} type defs to ${outPath}`,
);
