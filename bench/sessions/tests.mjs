import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The tests for one step, picked by MCPEDIA_BENCH_STEP. Questions come from
 * the Kestrel dataset; each read passes when its answer contains the
 * question's needle. Writes pass when every part of the new fact (its
 * needles) is found in the memory afterwards.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { questions } = await import(pathToFileURL(join(ROOT, 'dist-bench/bench/dataset/index.js')).href);

const WRITES = [
  {
    fact: 'The mobile apps now require iOS 17 or later and Android 12 or later.',
    needle: 'iOS 17',
    needles: ['iOS 17', 'Android 12'],
  },
  {
    fact: 'Live chat support now answers within 2 business hours.',
    needle: '2 business hours',
  },
];

const dry = process.env.MCPEDIA_BENCH_DRY === '1';

function read(q) {
  return {
    description: `read: ${q.question}`,
    vars: {
      kind: 'read',
      needle: q.needle,
      prompt: `Using this project's memory, answer in one or two sentences: ${q.question}`,
    },
    assert: [{ type: 'icontains', value: q.needle }],
  };
}

function write(w) {
  return {
    description: `write: ${w.needle}`,
    vars: {
      kind: 'write',
      needle: w.needle,
      // Joined, since promptfoo would expand an array var into one test per item.
      needles: (w.needles ?? [w.needle]).join('|'),
      prompt: `Record this in the project's memory so future sessions know it: ${w.fact}`,
    },
    // A dry run writes nothing, so it only checks that the write check ran.
    assert: [{ type: 'icontains', value: dry ? '[write check:' : '[write check: landed]' }],
  };
}

// Every fifth question: eight spread across the seven topics.
const spread = questions.filter((_, i) => i % 5 === 0);

const STEPS = {
  check: [read(questions[0]), write(WRITES[0])],
  step3: [read(questions[0])],
  step4: [read(questions[0])],
  step5: [read(spread[1]), read(spread[2]), write(WRITES[0])],
  step6: [...spread.map(read), ...WRITES.map(write)],
  // The step 5 miss behind ADR 0020, alone, to check the snippet fix.
  keyprefix: [read(questions.find((q) => q.needle === 'kst_live_'))],
};
STEPS.onefile = STEPS.step6;

export default function tests() {
  const step = process.env.MCPEDIA_BENCH_STEP ?? 'check';
  const list = STEPS[step];
  if (!list) throw new Error(`Unknown step ${step}`);
  return list;
}
