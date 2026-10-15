// Generate a fake graph shaped like MCPedia data, for scale tests.
// Usage: node scripts/generate.mjs 50000 [www/data/generated-50000.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const count = Number(process.argv[2] ?? 10000);
const outPath = process.argv[3] ?? `www/data/generated-${count}.json`;

const nodeTypes = ['note', 'task', 'issue', 'plan', 'idea', 'research', 'library', 'decision', 'how-to'];
const edgeTypes = ['comments_on', 'references', 'related_to', 'addresses', 'depends_on'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const nodes = [];
const edges = [];
const plans = Math.max(1, Math.round(count / 200));

for (let i = 0; i < count; i++) {
  const type = i < plans ? 'plan' : pick(nodeTypes);
  const key = `${type}/item-${i}`;
  nodes.push({
    id: `default:${key}`,
    namespace: 'default',
    key,
    type,
    title: `${type} ${i}`,
    summary: `Generated ${type} number ${i}.`,
    body: '',
    properties: {},
    status: 'active',
  });
  if (i >= plans) {
    // Every node belongs to a plan (gives siblings), plus a few random links.
    edges.push({ from: `default:${key}`, to: nodes[Math.floor(Math.random() * plans)].id, type: 'part_of' });
    const extra = Math.floor(Math.random() * 3);
    for (let j = 0; j < extra; j++) {
      edges.push({ from: `default:${key}`, to: nodes[Math.floor(Math.random() * i)].id, type: pick(edgeTypes) });
    }
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ source: 'generated', typeDefs: [], nodes, edges }));
console.log(`Wrote ${nodes.length} nodes, ${edges.length} edges to ${outPath}`);
