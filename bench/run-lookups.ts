import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { nodes, paraphrases, questions, unanswerable } from './dataset/index.js';
import { openSession, seed, type GraphSession } from './graph.js';
import { RENDER_LEVELS } from '../src/core/render.js';
import {
  addDistractors,
  type LevelSizes,
  levelSizes,
  lifecycle,
  otherTopic,
  retrieval,
  SAME_TOPIC,
  saysNoMatch,
  type Score,
} from './lookups.js';
import { searchWords } from './strategies.js';
import { pickCounter } from './tokens.js';

/**
 * `npm run bench:lookups` runs the lookup checks from ADR 0024 and writes
 * bench/lookups.md and bench/lookups.json. No model is called; exact token
 * counts use the free count_tokens endpoint when a key is set, else an estimate.
 * Pass sizes to change the scaling run, e.g. `npm run bench:lookups -- 1000 10000`.
 */

const MODEL = 'claude-haiku-5-5';
const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../bench');
const DEFAULT_SIZES = [1_000, 10_000, 100_000];
const REPEATS = 3;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const round = (x: number, places = 2) => Number(x.toFixed(places));

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

interface Accuracy {
  questions: Score;
  paraphrases: Score;
}

interface ScaleRow {
  distractors: number;
  nodes: number;
  /** Database and WAL on disk, other-topic graph. */
  dbBytes: number;
  loadSeconds: number;
  searchMs: { p50: number; p95: number };
  getMs: { p50: number; p95: number };
  /** Distractors about other topics (this repo's docs): the everyday case. */
  otherTopic: Accuracy;
  /** Distractors made of the dataset's own words: the worst case. */
  sameTopic: Accuracy;
}

async function accuracy(session: GraphSession): Promise<Accuracy> {
  return {
    questions: (await retrieval(session, questions)).score,
    paraphrases: (await retrieval(session, paraphrases)).score,
  };
}

/** Times search and get on the other-topic graph, then checks accuracy on both graphs. */
async function scaleRow(distractors: number, dir: string, other: string[]): Promise<ScaleRow> {
  const path = join(dir, `scale-${distractors}.db`);
  let session = await openSession(path);
  const start = performance.now();
  await seed(session);
  await addDistractors(session, distractors, other);
  const loadSeconds = (performance.now() - start) / 1000;

  // One warm-up pass, then the timed ones.
  const searches: number[] = [];
  const gets: number[] = [];
  for (let r = 0; r <= REPEATS; r++) {
    for (const q of questions) {
      const query = searchWords(q.question).join(' ');
      const s = await timed(() => session.call('search', { query, level: 'summary', limit: 5 }));
      const g = await timed(() => session.call('get', { keys: [q.answer] }));
      if (r > 0) (searches.push(s), gets.push(g));
    }
  }
  const otherTopic = await accuracy(session);
  await session.close();
  const dbBytes = ['', '-wal']
    .map((s) => `${path}${s}`)
    .filter(existsSync)
    .reduce((n, f) => n + statSync(f).size, 0);

  session = await openSession();
  await seed(session);
  await addDistractors(session, distractors, SAME_TOPIC);
  const sameTopic = await accuracy(session);
  await session.close();

  return {
    distractors,
    nodes: nodes.length + distractors,
    dbBytes,
    loadSeconds: round(loadSeconds, 1),
    searchMs: { p50: round(percentile(searches, 50)), p95: round(percentile(searches, 95)) },
    getMs: { p50: round(percentile(gets, 50)), p95: round(percentile(gets, 95)) },
    otherTopic,
    sameTopic,
  };
}

/** Every markdown file under docs/, as the other-topic word source. */
function docsText(dir: string): string {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
    .join('\n');
}

const scoreCells = (s: Score) => `${s.hit1}/${s.n} | ${s.hit3}/${s.n} | ${s.mrr.toFixed(2)}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2).map(Number);
  const sizes = args.length ? args : DEFAULT_SIZES;
  const counter = await pickCounter(MODEL, join(BENCH_DIR, '.token-cache.json'));

  // F1 and F2 on the plain dataset.
  let session: GraphSession = await openSession();
  await seed(session);
  const exact = await retrieval(session, questions);
  const reworded = await retrieval(session, paraphrases);
  const noMatch = [];
  for (const q of unanswerable) noMatch.push({ question: q, ...(await saysNoMatch(session, q)) });
  const sizesPerQuestion: { search: LevelSizes; get: LevelSizes }[] = [];
  for (const q of questions) sizesPerQuestion.push(await levelSizes(session, counter, q));
  await session.close();
  counter.flush();

  const median = (values: number[]) => percentile(values, 50);
  const levels = RENDER_LEVELS.map((level) => ({
    level,
    search: median(sizesPerQuestion.map((s) => s.search[level])),
    get: median(sizesPerQuestion.map((s) => s.get[level])),
  }));

  // F4 on a fresh copy, since it changes the graph.
  session = await openSession();
  await seed(session);
  const checks = await lifecycle(session);
  await session.close();

  // F3: the dataset hidden among generated nodes.
  const dir = mkdtempSync(join(tmpdir(), 'mcpdia-lookups-'));
  const scale: ScaleRow[] = [];
  const other = otherTopic(docsText(join(BENCH_DIR, '../docs')));
  try {
    for (const n of [0, ...sizes]) {
      console.error(`Scaling: ${n} distractors…`);
      scale.push(await scaleRow(n, dir, other));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  const honest = noMatch.filter((r) => r.ok).length;
  const lines: string[] = [];
  lines.push('# Lookup results', '');
  lines.push(
    `Method: [ADR 0024](../docs/decisions/0024-lookup-tests.md). No model: every number is the real server's answer to a scripted call. ` +
      `Dataset: ${nodes.length} Kestrel nodes, ${questions.length} questions, the same questions reworded, and ${unanswerable.length} questions it can't answer. ` +
      `Tokens: ${counter.name}.`,
    '',
  );
  if (!counter.exact)
    lines.push('Token counts are estimates (characters / 4). Retrieval and timing numbers are exact.', '');

  lines.push('## Retrieval', '');
  lines.push(
    "Where the answer lands when the question's words are searched. hit@3 means the answer is in the top three results.",
    '',
  );
  lines.push('| Questions | hit@1 | hit@3 | MRR |', '|---|---|---|---|');
  lines.push(`| As written | ${scoreCells(exact.score)} |`);
  lines.push(`| Reworded | ${scoreCells(reworded.score)} |`, '');
  lines.push(
    `**Says when nothing matches:** ${honest}/${noMatch.length} questions with no answer in the graph got "no match" instead of a hit.`,
    '',
  );
  const misses = [...exact.score.missed, ...reworded.score.missed];
  if (misses.length) lines.push('Not in the top 3:', '', ...misses.map((m) => `- ${m}`), '');

  lines.push('## Tokens per render level', '');
  lines.push('Median over the 40 questions: a five-result search, and a get of the node that answers it.', '');
  lines.push('| Level | Search, 5 results | Get, 1 node |', '|---|---|---|');
  for (const l of levels) lines.push(`| ${l.level} | ${l.search} | ${l.get} |`);
  lines.push('');

  lines.push('## Stale facts', '');
  lines.push(
    `${checks.length - failed.length}/${checks.length} checks passed after superseding 5 facts, deleting 3 and flagging 3 as wrong: ` +
      'an old fact never reads as current.',
    '',
  );
  for (const c of failed) lines.push(`- **Failed:** ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  if (failed.length) lines.push('');

  lines.push('## Scaling', '');
  lines.push(
    'The dataset hidden among generated nodes: text sampled at natural word frequency, with no real facts. ' +
      "**Other topics** samples this repo's docs, the everyday case of a graph that holds more than one project. " +
      "**Same topic** samples the dataset's own words, the worst case: thousands of nodes that look like the answers. " +
      `Latency is per tool call through MCP on the other-topic graph, ${REPEATS} passes over the 40 questions.`,
    '',
  );
  lines.push(
    '| Nodes | Search p50 / p95 ms | Get p50 / p95 ms | DB size | Other topics: hit@3 | reworded | Same topic: hit@3 | reworded |',
    '|---|---|---|---|---|---|---|---|',
  );
  const pair = (a: Accuracy) => `${a.questions.hit3}/${a.questions.n} | ${a.paraphrases.hit3}/${a.paraphrases.n}`;
  for (const s of scale) {
    lines.push(
      `| ${s.nodes.toLocaleString('en-US')} | ${s.searchMs.p50} / ${s.searchMs.p95} | ${s.getMs.p50} / ${s.getMs.p95} | ` +
        `${(s.dbBytes / 1e6).toFixed(1)} MB | ${pair(s.otherTopic)} | ${s.distractors ? pair(s.sameTopic) : '- | -'} |`,
    );
  }
  lines.push('', `Machine: ${process.platform}, Node ${process.version}.`);
  const report = lines.join('\n') + '\n';

  console.log(report);
  mkdirSync(BENCH_DIR, { recursive: true });
  writeFileSync(join(BENCH_DIR, 'lookups.md'), report);
  writeFileSync(
    join(BENCH_DIR, 'lookups.json'),
    JSON.stringify(
      {
        counter: counter.name,
        exactTokens: counter.exact,
        platform: process.platform,
        node: process.version,
        retrieval: { asWritten: exact, reworded },
        noMatch,
        levels,
        lifecycle: checks,
        scale,
      },
      null,
      2,
    ) + '\n',
  );
  console.error('Wrote bench/lookups.md and bench/lookups.json.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
