import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes data/sessions.csv: one row per paid session, joined with its pass or
 * fail from the run's promptfoo report. Only numbers, names and the question go
 * in, never answers or transcripts, so the file carries no local paths and is
 * safe to commit.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');

const sessions = readFileSync(join(RESULTS, 'sessions.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// Pass or fail per session, keyed by run and session number.
const passed = new Map();
for (const run of new Set(sessions.map((s) => s.run))) {
  const report = join(RESULTS, `${run}.json`);
  if (!existsSync(report)) continue;
  const { results } = JSON.parse(readFileSync(report, 'utf8'));
  for (const r of results.results ?? results) {
    const meta = r.response?.metadata;
    if (meta) passed.set(`${run}#${meta.n}`, { pass: r.success, needle: r.vars?.needle ?? '' });
  }
}

const columns = [
  'run',
  'step',
  'at',
  'n',
  'side',
  'kind',
  'question',
  'needle',
  'repeat',
  'pass',
  'cost_usd',
  'input_tokens',
  'uncached_input_tokens',
  'cache_write_tokens',
  'cache_read_tokens',
  'output_tokens',
  'turns',
  'tool_calls',
  'model',
];

function quote(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// The same test on the same side runs once per repeat; number them in order.
const seen = new Map();
const rows = sessions.map((s) => {
  const result = passed.get(`${s.run}#${s.n}`);
  const id = `${s.run}#${s.side}#${s.prompt}`;
  seen.set(id, (seen.get(id) ?? 0) + 1);
  return [
    s.run,
    s.run.replace(/-\d{4}-\d{2}-\d{2}T.*$/, ''),
    s.at,
    s.n,
    s.side,
    s.kind,
    s.prompt.replace(/^.*?: /, ''),
    result?.needle,
    seen.get(id),
    result ? (result.pass ? 'pass' : 'fail') : '',
    s.costUsd,
    s.inputTokens,
    s.uncachedInputTokens,
    s.cacheWriteTokens,
    s.cacheReadTokens,
    s.outputTokens,
    s.turns,
    Object.entries(s.toolCalls ?? {})
      .map(([name, count]) => `${name}:${count}`)
      .join(' '),
    (s.models ?? []).join(' '),
  ];
});

const lines = [columns, ...rows].map((row) => row.map(quote).join(','));
mkdirSync(join(HERE, 'data'), { recursive: true });
writeFileSync(join(HERE, 'data', 'sessions.csv'), lines.join('\n') + '\n');
console.log(`Wrote data/sessions.csv: ${rows.length} sessions from ${new Set(sessions.map((s) => s.run)).size} runs.`);
