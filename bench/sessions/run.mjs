import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `node run.mjs <step>` runs one step of the plan. `check` calls no model.
 * Paid steps print what they would run and stop; add --yes to run them.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const STEPS = {
  check: { sides: 'mcpedia|markdown|markdown-onefile', sessions: 6, estimate: 0, cap: 0, repeat: 1, dry: true },
  step3: { sides: 'mcpedia', sessions: 1, estimate: 0.01, cap: 0.05, repeat: 1 },
  step4: { sides: 'markdown', sessions: 1, estimate: 0.01, cap: 0.05, repeat: 1 },
  step5: { sides: 'mcpedia|markdown', sessions: 6, estimate: 0.05, cap: 0.15, repeat: 1 },
  step6: { sides: 'mcpedia|markdown', sessions: 40, estimate: 0.3, cap: 0.75, repeat: 2 },
  keyprefix: { sides: 'mcpedia|markdown', sessions: 2, estimate: 0.01, cap: 0.05, repeat: 1 },
  // The step 6 tests on the one-file side only, to set beside a step 6 run.
  onefile: { sides: 'markdown-onefile', sessions: 20, estimate: 0.12, cap: 0.5, repeat: 2 },
};

const [name, ...flags] = process.argv.slice(2);
const step = STEPS[name];
if (!step) {
  console.error(`Usage: node run.mjs <${Object.keys(STEPS).join('|')}> [--yes]`);
  process.exit(2);
}

const runId = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
console.log(
  `${name}: ${step.sessions} session(s), side(s) ${step.sides}, ` +
    (step.dry ? 'dry run, no model calls.' : `estimated $${step.estimate}, hard cap $${step.cap}.`),
);
if (!step.dry && !flags.includes('--yes')) {
  console.log('Nothing ran. Add --yes to run this paid step.');
  process.exit(0);
}

const pkgDir = join(HERE, 'node_modules', 'promptfoo');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const bin = join(pkgDir, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.promptfoo);

const result = spawnSync(
  process.execPath,
  [
    bin,
    'eval',
    '--config',
    'promptfooconfig.yaml',
    '--filter-providers',
    `^(${step.sides})$`,
    '--repeat',
    String(step.repeat),
    '--max-concurrency',
    '1',
    '--no-cache',
    '--output',
    join('results', `${runId}.json`),
  ],
  {
    cwd: HERE,
    stdio: 'inherit',
    env: {
      ...process.env,
      MCPEDIA_BENCH_STEP: name,
      MCPEDIA_BENCH_RUN: runId,
      MCPEDIA_BENCH_CAP_USD: String(step.cap),
      MCPEDIA_BENCH_DRY: step.dry ? '1' : '0',
      PROMPTFOO_DISABLE_TELEMETRY: '1',
      PROMPTFOO_DISABLE_UPDATE: '1',
    },
  },
);
process.exit(result.status ?? 1);
