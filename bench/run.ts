import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { files, nodes, questions, renderMarkdown, renderWhole } from './dataset/index.js';
import { openSession, seed } from './graph.js';
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

/** Runs the benchmark from ADR 0013 and prints the results; exact runs also write bench/results.md. */

const MODEL = 'claude-opus-5-5';
// Compiled to dist-bench/bench/, so the source folder is two levels up.
const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../bench');

const BASELINES = ['index-then-file', 'grep-then-file', 'whole-file'] as const;
type Baseline = (typeof BASELINES)[number];

interface Row {
  question: string;
  graph: Outcome;
  baselines: Record<Baseline, Outcome>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

async function main(): Promise<void> {
  const counter = await pickCounter(MODEL, join(BENCH_DIR, '.token-cache.json'));
  const session = await openSession();
  await seed(session);

  const markdown = renderMarkdown();
  const md: MarkdownMemory = {
    files: markdown,
    whole: renderWhole(),
    fileOf: (key) => `${nodes.find((n) => n.key === key)!.file}.md`,
  };

  const overhead = await graphOverhead(session, counter);
  const rows: Row[] = [];
  for (const q of questions) {
    rows.push({
      question: q.question,
      graph: await graph(session, counter, q),
      baselines: {
        'index-then-file': await indexThenFile(md, counter, q),
        'grep-then-file': await grepThenFile(md, counter, q),
        'whole-file': await wholeFile(md, counter, q),
      },
    });
  }
  await session.close();
  counter.flush();

  const corpus = await counter.count(md.whole);
  const graphPer = rows.map((r) => r.graph.tokens);
  const found = (outcomes: Outcome[]) => `${outcomes.filter((o) => o.found).length}/${outcomes.length}`;

  const summary = BASELINES.map((name) => {
    const base = rows.map((r) => r.baselines[name].tokens);
    return {
      name,
      found: found(rows.map((r) => r.baselines[name])),
      median: median(base),
      total: sum(base),
      saving: median(rows.map((r) => 1 - (r.graph.tokens + overhead) / r.baselines[name].tokens)),
      savingNoOverhead: median(rows.map((r) => 1 - r.graph.tokens / r.baselines[name].tokens)),
    };
  });
  const headline = summary[0]!;

  const lines: string[] = [];
  lines.push('# Benchmark results', '');
  lines.push(
    `Method: [ADR 0013](../docs/decisions/0013-benchmark-method.md). Tokens: ${counter.name}. ` +
      `Dataset: ${nodes.length} nodes in ${files.length} topic files (${corpus} tokens of markdown), ${questions.length} questions.`,
    '',
  );
  if (!counter.exact) lines.push('**Estimate only. Do not publish these numbers.**', '');
  lines.push(
    `**Headline:** answering one question in a fresh session, MCPdia used a median **${pct(headline.saving)} fewer tokens** ` +
      `than reading the right markdown topic file (${pct(headline.savingNoOverhead)} before MCPdia's fixed session cost).`,
    '',
  );
  lines.push(
    '| Strategy | Answers found | Median tokens per question | Total tokens | MCPdia saving (median, with session cost) | Without session cost |',
  );
  lines.push('|---|---|---|---|---|---|');
  lines.push(
    `| MCPdia: search, then get | ${found(rows.map((r) => r.graph))} | ${median(graphPer)} + ${overhead} session | ${sum(graphPer)} + ${overhead} | | |`,
  );
  for (const s of summary) {
    lines.push(
      `| Markdown: ${s.name} | ${s.found} | ${s.median} | ${s.total} | ${pct(s.saving)} | ${pct(s.savingNoOverhead)} |`,
    );
  }
  lines.push(
    '',
    `MCPdia's fixed session cost: ${overhead} tokens (tool definitions, server instructions and one \`orient\` call).`,
    '',
  );
  lines.push('## Per question', '');
  lines.push('| Question | MCPdia | Found | Index + file | Grep + file | Whole file |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    const b = r.baselines;
    lines.push(
      `| ${r.question} | ${r.graph.tokens} (${r.graph.steps} calls) | ${r.graph.found ? 'yes' : '**no**'} | ` +
        `${b['index-then-file'].tokens} | ${b['grep-then-file'].tokens}${b['grep-then-file'].found ? '' : ' (missed)'} | ${b['whole-file'].tokens} |`,
    );
  }
  const report = lines.join('\n') + '\n';

  console.log(report);
  if (counter.exact) {
    writeFileSync(join(BENCH_DIR, 'results.md'), report);
    writeFileSync(
      join(BENCH_DIR, 'results.json'),
      JSON.stringify({ counter: counter.name, nodes: nodes.length, corpus, overhead, summary, rows }, null, 2) + '\n',
    );
    console.log('Wrote bench/results.md and bench/results.json.');
  } else {
    mkdirSync(join(BENCH_DIR, '.out'), { recursive: true });
    writeFileSync(join(BENCH_DIR, '.out', 'estimate.md'), report);
    console.log('Estimate only: wrote bench/.out/estimate.md, not the published results.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
