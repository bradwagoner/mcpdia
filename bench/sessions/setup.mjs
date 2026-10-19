import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Builds the two starting points from the Kestrel dataset: a markdown memory
 * (CLAUDE.md index plus topic files) and an MCPedia database. Needs the root
 * `npm run bench:build` first. No model is called.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const FIXTURES = join(HERE, 'fixtures');

const { renderMarkdown } = await import(pathToFileURL(join(ROOT, 'dist-bench/bench/dataset/index.js')).href);
const { openSession, seed } = await import(pathToFileURL(join(ROOT, 'dist-bench/bench/graph.js')).href);

rmSync(FIXTURES, { recursive: true, force: true });
const markdownDir = join(FIXTURES, 'markdown');
mkdirSync(markdownDir, { recursive: true });
for (const [name, text] of renderMarkdown()) {
  // The index loads at session start the way Claude Code loads CLAUDE.md; topic files are read on demand.
  writeFileSync(join(markdownDir, name === 'MEMORY.md' ? 'CLAUDE.md' : name), text);
}

const dbPath = join(FIXTURES, 'mcpedia.db');
const session = await openSession(dbPath);
await seed(session);
await session.close();
for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true });

writeFileSync(
  join(FIXTURES, 'README.txt'),
  'Built by setup.mjs. Sessions copy these; they are never changed in place.\n',
);
console.log(`Wrote ${markdownDir} and ${dbPath}`);
