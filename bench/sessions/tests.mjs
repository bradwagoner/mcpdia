import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The tests for one step, picked by MCPDIA_BENCH_STEP. Questions come from
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

const dry = process.env.MCPDIA_BENCH_DRY === '1';

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

/** Several questions in one prompt: the same session pays the fixed cost once and answers them all. */
function multi(qs) {
  return {
    description: `multi: ${qs.length} questions`,
    vars: {
      kind: 'read',
      needle: qs.map((q) => q.needle).join('|'),
      // More questions need more turns: a search and a get or two each.
      maxTurns: 6 + 4 * qs.length,
      prompt:
        `Using this project's memory, answer each question in one or two sentences, numbered: ` +
        qs.map((q, i) => `${i + 1}) ${q.question}`).join(' '),
    },
    assert: qs.map((q) => ({ type: 'icontains', value: q.needle })),
  };
}

/** A read against the bigger memory from setup.mjs: the Kestrel facts plus filler, 300 nodes. */
function grown(q) {
  const test = read(q);
  return { ...test, description: `growth-300 ${test.description}`, vars: { ...test.vars, fixture: 'growth-300' } };
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
  // P1 (ADR 0024): one session, several questions.
  multi: [multi(spread.slice(0, 3)), multi(spread)],
  // P3: the step 6 reads, on a memory grown to 300 nodes.
  growth: spread.map(grown),
};
STEPS.onefile = STEPS.step6;
STEPS.multicheck = STEPS.multi;
STEPS.growthcheck = STEPS.growth;

export default function tests() {
  const step = process.env.MCPDIA_BENCH_STEP ?? 'check';
  const list = STEPS[step];
  if (!list) throw new Error(`Unknown step ${step}`);
  return list;
}
