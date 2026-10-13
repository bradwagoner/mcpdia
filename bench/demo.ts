import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './dataset/index.js';
import { openSession, seed } from './graph.js';

/**
 * `demo markdown` rewrites bench/dataset/markdown from the dataset source.
 * `demo seed <db>` loads the dataset into a fresh database for demos and recordings.
 */
const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../bench');

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2);
  if (command === 'markdown') {
    const dir = join(BENCH_DIR, 'dataset', 'markdown');
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of renderMarkdown()) writeFileSync(join(dir, name), text);
    console.log(`Wrote ${dir}`);
  } else if (command === 'seed' && target) {
    const session = await openSession(target);
    await seed(session);
    await session.close();
    console.log(`Seeded the demo dataset into ${target}`);
  } else {
    console.error('Usage: demo markdown | demo seed <db-path>');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
