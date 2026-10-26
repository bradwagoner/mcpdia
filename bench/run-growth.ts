import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodes, questions, renderMarkdown, renderWhole } from './dataset/index.js';
import { openSession, seed } from './graph.js';
import { distractorNodes, otherTopic } from './lookups.js';
import {
  type MarkdownMemory,
  type Outcome,
  graph,
  graphOverhead,
  grepThenFile,
  indexThenFile,
  wholeFile,
} from './strategies.js';
import { pickCounter } from './tokens.js';

/**
 * `npm run bench:growth` measures what one answer costs to read as memory grows
 * (ADR 0024): the Kestrel facts plus generated filler, kept both as an MCPdia graph
 * and as markdown files, with the scripted strategies from bench/strategies.ts.
 * No model is called. Writes bench/growth.md and bench/growth.json.
 * Pass sizes (total nodes) to change the steps, e.g. `npm run bench:growth -- 200 400`.
 */

const MODEL = 'claude-haiku-5-5';
const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../bench');
const DEFAULT_SIZES = [nodes.length, 200, 400, 800, 1_600];
const STRATEGIES = ['mcpdia', 'index-then-file', 'grep-then-file', 'whole-file'] as const;
type Strategy = (typeof STRATEGIES)[number];

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

interface Step {
  nodes: number;
  /** Tokens in the one-file memory: what a session that loads it whole pays up front. */
  wholeFileTokens: number;
  /** Median tokens read to answer one question, and how many answers were found. */
  perQuestion: Record<Strategy, { median: number; found: number }>;
}

/** Every markdown file under docs/: the filler's word source, as in the scaling run. */
function docsText(dir: string): string {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
    .join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).map(Number);
  const sizes = args.length ? args : DEFAULT_SIZES;
  const counter = await pickCounter(MODEL, join(BENCH_DIR, '.token-cache.json'));
  const words = otherTopic(docsText(join(BENCH_DIR, '../docs')));

  let overhead = 0;
  const steps: Step[] = [];
  for (const size of sizes) {
    console.error(`Growth: ${size} nodes…`);
    const data = [...nodes, ...distractorNodes(Math.max(0, size - nodes.length), words)];
    const session = await openSession();
    await seed(session, data);
    if (!overhead) overhead = await graphOverhead(session, counter);
    const md: MarkdownMemory = {
      files: renderMarkdown(data),
      whole: renderWhole(data),
      fileOf: (key) => `${data.find((n) => n.key === key)!.file}.md`,
    };
    const outcomes: Record<Strategy, Outcome[]> = {
      mcpdia: [],
      'index-then-file': [],
      'grep-then-file': [],
      'whole-file': [],
    };
    for (const q of questions) {
      outcomes.mcpdia.push(await graph(session, counter, q));
      outcomes['index-then-file'].push(await indexThenFile(md, counter, q));
      outcomes['grep-then-file'].push(await grepThenFile(md, counter, q));
      outcomes['whole-file'].push(await wholeFile(md, counter, q));
    }
    await session.close();
    counter.flush();
    const perQuestion = Object.fromEntries(
      STRATEGIES.map((s) => [
        s,
        {
          median: Math.round(median(outcomes[s].map((o) => o.tokens))),
          found: outcomes[s].filter((o) => o.found).length,
        },
      ]),
    ) as Step['perQuestion'];
    steps.push({ nodes: data.length, wholeFileTokens: await counter.count(md.whole), perQuestion });
  }

  const n = questions.length;
  const lines: string[] = [];
  lines.push('# Cost as memory grows', '');
  lines.push(
    `Method: [ADR 0024](../docs/decisions/0024-lookup-tests.md). The ${nodes.length} Kestrel facts plus generated filler ` +
      "(text sampled from this repo's docs, no real facts), kept both as an MCPdia graph and as markdown. " +
      `Each strategy answers the same ${n} questions the way \`npm run bench\` does: no model, tokens read per question. ` +
      `Tokens: ${counter.name}.`,
    '',
  );
  if (!counter.exact) lines.push('Token counts are estimates (characters / 4).', '');
  lines.push('Median tokens read to answer one question (answers found in brackets):', '');
  lines.push(
    '| Nodes | MCPdia: search, then get | Index, then the right file | Grep, then files | One file, read whole |',
    '|---|---|---|---|---|',
  );
  for (const s of steps) {
    const cell = (k: Strategy) => `${s.perQuestion[k].median.toLocaleString('en-US')} (${s.perQuestion[k].found}/${n})`;
    lines.push(
      `| ${s.nodes.toLocaleString('en-US')} | ${cell('mcpdia')} | ${cell('index-then-file')} | ${cell('grep-then-file')} | ${cell('whole-file')} |`,
    );
  }
  lines.push(
    '',
    `MCPdia's fixed cost with every tool definition loaded is ${overhead} tokens per session, at any size. ` +
      'Claude Code loads tool definitions on demand, so a real session usually pays less.',
    '',
    '"Index, then the right file" always opens the file that holds the answer: the best case for split files.',
  );
  const report = lines.join('\n') + '\n';

  console.log(report);
  writeFileSync(join(BENCH_DIR, 'growth.md'), report);
  writeFileSync(
    join(BENCH_DIR, 'growth.json'),
    JSON.stringify({ counter: counter.name, exactTokens: counter.exact, questions: n, overhead, steps }, null, 2) +
      '\n',
  );
  console.error('Wrote bench/growth.md and bench/growth.json.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
