import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paraphrases, questions, unanswerable } from '../../bench/dataset/index.js';
import { type GraphSession, openSession, seed } from '../../bench/graph.js';
import { addDistractors, levelSizes, lifecycle, otherTopic, retrieval, saysNoMatch } from '../../bench/lookups.js';
import { estimateCounter } from '../../bench/tokens.js';

/**
 * Lookup floors (ADR 0024). Each floor is the score when it was set: raise it when
 * search gets better, and treat a drop as a regression. `npm run bench:lookups`
 * prints the full numbers.
 */
describe('lookups on the demo graph', () => {
  let session: GraphSession;

  beforeAll(async () => {
    session = await openSession();
    await seed(session);
  });

  afterAll(async () => {
    await session.close();
  });

  it('puts the answer in the top 3 for questions as written', async () => {
    const { score } = await retrieval(session, questions);
    expect(score.hit3, score.missed.join('\n')).toBeGreaterThanOrEqual(39);
  });

  it('puts the answer in the top 3 for reworded questions', async () => {
    const { score } = await retrieval(session, paraphrases);
    expect(score.hit3, score.missed.join('\n')).toBeGreaterThanOrEqual(34);
  });

  it.each(unanswerable)('says nothing matched: "%s"', async (question) => {
    const { ok, header } = await saysNoMatch(session, question);
    expect(ok, header).toBe(true);
  });

  it('returns more at each render level', async () => {
    const counter = estimateCounter();
    for (const q of questions.slice(0, 10)) {
      const { search, get } = await levelSizes(session, counter, q);
      expect(search.title, q.question).toBeLessThan(search.summary);
      expect(search.summary, q.question).toBeLessThanOrEqual(search.snippet);
      expect(search.snippet, q.question).toBeLessThanOrEqual(search.full);
      expect(get.title, q.question).toBeLessThan(get.full);
    }
  });
});

describe('stale facts', () => {
  it('never shows a superseded, deleted or flagged fact as current', async () => {
    const session = await openSession();
    await seed(session);
    const failed = (await lifecycle(session)).filter((c) => !c.ok);
    await session.close();
    expect(failed.map((c) => `${c.name}: ${c.detail ?? ''}`)).toEqual([]);
  });
});

describe('lookups among 1,000 other nodes', () => {
  it('still finds the answers', async () => {
    const docs = resolve(import.meta.dirname, '../../docs');
    const text = readdirSync(docs, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
      .join('\n');
    const session = await openSession();
    await seed(session);
    await addDistractors(session, 1_000, otherTopic(text));
    const { score } = await retrieval(session, questions);
    await session.close();
    expect(score.hit3, score.missed.join('\n')).toBeGreaterThanOrEqual(39);
  }, 60_000);
});
