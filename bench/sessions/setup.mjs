import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Builds the starting points from the Kestrel dataset: a markdown memory
 * (CLAUDE.md index plus topic files), the same facts as one CLAUDE.md, and an
 * MCPdia database. `fixtures/growth-300/` holds the same three with filler added
 * up to 300 nodes, for the growth step. Needs the root `npm run bench:build`
 * first. No model is called.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const FIXTURES = join(HERE, 'fixtures');

const { renderMarkdown, renderWhole } = await import(
  pathToFileURL(join(ROOT, 'dist-bench/bench/dataset/index.js')).href
);
const { openSession, seed } = await import(pathToFileURL(join(ROOT, 'dist-bench/bench/graph.js')).href);
const { nodes } = await import(pathToFileURL(join(ROOT, 'dist-bench/bench/dataset/index.js')).href);
const { distractorNodes, otherTopic } = await import(pathToFileURL(join(ROOT, 'dist-bench/bench/lookups.js')).href);

/** The three sides' starting points for one set of nodes. */
async function build(dir, data) {
  const markdownDir = join(dir, 'markdown');
  mkdirSync(markdownDir, { recursive: true });
  for (const [name, text] of renderMarkdown(data)) {
    // The index loads at session start the way Claude Code loads CLAUDE.md; topic files are read on demand.
    writeFileSync(join(markdownDir, name === 'MEMORY.md' ? 'CLAUDE.md' : name), text);
  }

  // The same facts in one CLAUDE.md, which loads whole at session start.
  const onefileDir = join(dir, 'markdown-onefile');
  mkdirSync(onefileDir, { recursive: true });
  writeFileSync(join(onefileDir, 'CLAUDE.md'), renderWhole(data) + '\n');

  const dbPath = join(dir, 'mcpdia.db');
  const session = await openSession(dbPath);
  await seed(session, data);
  await session.close();
  for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
  console.log(`Wrote ${markdownDir}, ${onefileDir} and ${dbPath}`);
}

rmSync(FIXTURES, { recursive: true, force: true });
await build(FIXTURES, nodes);

// Filler sampled from this repo's docs, as in `npm run bench:growth`. 300 nodes keeps the
// one-file side's requests under 100k tokens, past which the API charges more.
const docs = join(ROOT, 'docs');
const docsText = readdirSync(docs, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && e.name.endsWith('.md'))
  .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
  .join('\n');
await build(join(FIXTURES, 'growth-300'), [...nodes, ...distractorNodes(300 - nodes.length, otherTopic(docsText))]);

writeFileSync(
  join(FIXTURES, 'README.txt'),
  'Built by setup.mjs. Sessions copy these; they are never changed in place.\n',
);
