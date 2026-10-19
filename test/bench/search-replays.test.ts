import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type GraphSession, openSession, seed } from '../../bench/graph.js';

/** Searches models made in bench sessions that once missed the answer, replayed on the demo graph. */
describe('bench search replays', () => {
  let session: GraphSession;

  beforeAll(async () => {
    session = await openSession();
    await seed(session);
  });

  afterAll(async () => {
    await session.close();
  });

  it.each([
    // One weak hit matched every word and hid the answer (ADR 0021).
    ['EU workspaces AWS region', 'concept/regions'],
    ['API availability SLO', 'concept/slos'],
  ])('"%s" shows %s', async (query, key) => {
    expect(await session.call('search', { query, level: 'title' })).toContain(`- ${key} [`);
  });

  it('shows the API key prefix in the snippet (ADR 0020)', async () => {
    expect(await session.call('search', { query: 'live API key prefix', level: 'snippet' })).toContain('kst_live_');
  });
});
