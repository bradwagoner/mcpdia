import { writeNode } from '../src/core/upsert.js';
import { soloContext } from '../src/context.js';
import { RENDER_LEVELS, type RenderLevel } from '../src/core/render.js';
import { type DemoNode, files, nodes, type Question, questions } from './dataset/index.js';
import { typeOf } from './dataset/types.js';
import type { GraphSession } from './graph.js';
import { searchWords } from './strategies.js';
import type { TokenCounter } from './tokens.js';

/**
 * Deterministic lookup checks (ADR 0024): no model, just the real server's
 * answers. Shared by the tests in test/bench and by `npm run bench:lookups`.
 */

/** One search result line: `- concept/sso [concept] SSO (matched: sso)`. */
export interface Hit {
  key: string;
  line: string;
  /** Matched every search word; partial matches carry a `matched:` label. */
  full: boolean;
}

export function parseHits(text: string): Hit[] {
  return [...text.matchAll(/^- (\S+) \[.*$/gm)].map((m) => ({
    key: m[1]!,
    line: m[0],
    full: !m[0].includes('matched: '),
  }));
}

export interface Ranked {
  question: string;
  answer: string;
  /** 1-based place of the answer in the results, or null when it is not in them. */
  rank: number | null;
  /** The answer matched every search word. */
  full: boolean;
}

/** Where the answer lands when the question's words are searched, as the benchmark searches them. */
export async function rank(session: GraphSession, q: Question, limit = 10): Promise<Ranked> {
  const text = await session.call('search', { query: searchWords(q.question).join(' '), level: 'title', limit });
  const hits = parseHits(text);
  const at = hits.findIndex((h) => h.key === q.answer);
  return { question: q.question, answer: q.answer, rank: at < 0 ? null : at + 1, full: at >= 0 && hits[at]!.full };
}

export interface Score {
  n: number;
  hit1: number;
  hit3: number;
  /** Mean reciprocal rank: 1 when every answer is first, 0.5 when every answer is second. */
  mrr: number;
  /** Questions whose answer was not in the top 3. */
  missed: string[];
}

export function score(rows: Ranked[]): Score {
  return {
    n: rows.length,
    hit1: rows.filter((r) => r.rank === 1).length,
    hit3: rows.filter((r) => r.rank !== null && r.rank <= 3).length,
    mrr: rows.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / rows.length,
    missed: rows.filter((r) => r.rank === null || r.rank > 3).map((r) => r.question),
  };
}

export async function retrieval(session: GraphSession, list: Question[]): Promise<{ rows: Ranked[]; score: Score }> {
  const rows: Ranked[] = [];
  for (const q of list) rows.push(await rank(session, q));
  return { rows, score: score(rows) };
}

/** A question the graph can't answer passes when search says nothing matched every word. */
export async function saysNoMatch(session: GraphSession, question: string): Promise<{ ok: boolean; header: string }> {
  const text = await session.call('search', { query: searchWords(question).join(' '), level: 'title' });
  const header = text.split('\n')[0]!;
  return { ok: header.startsWith('No results') || header.startsWith('No node matched all words'), header };
}

export type LevelSizes = Record<RenderLevel, number>;

/** Tokens returned by a five-result search, and by a get of the answer, at each render level. */
export async function levelSizes(
  session: GraphSession,
  counter: TokenCounter,
  q: Question,
): Promise<{ search: LevelSizes; get: LevelSizes }> {
  const search = {} as LevelSizes;
  const get = {} as LevelSizes;
  const query = searchWords(q.question).join(' ');
  for (const level of RENDER_LEVELS) {
    search[level] = await counter.count(await session.call('search', { query, level, limit: 5 }));
    get[level] = await counter.count(await session.call('get', { keys: [q.answer], level }));
  }
  return { search, get };
}

// --- distractors -----------------------------------------------------------

/** Small seeded generator, so every run builds the same distractors. */
function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];

/**
 * Every word of the dataset, repeats included, so a uniform pick samples words at
 * their natural frequency: common words stay common and rare ones stay rare.
 * Distractors made from these are about the same topics as the answers: a worst case.
 */
export const SAME_TOPIC = nodes.flatMap((n) => wordsOf(`${n.title} ${n.summary} ${n.body}`));

/** Every word of some other text, such as this repo's own docs: distractors about other topics. */
export function otherTopic(text: string): string[] {
  return wordsOf(text);
}

const DISTRACTOR_TYPES = ['note', 'task', 'issue', 'idea', 'concept', 'decision', 'runbook'];

/**
 * `count` nodes of text sampled from `words`: real word mix, random order, no facts.
 * Each is filed in one of the dataset's topic files, round robin, for the markdown side.
 */
export function distractorNodes(count: number, words: string[], seed = 24): DemoNode[] {
  const random = prng(seed);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
  const text = (min: number, max: number) =>
    Array.from({ length: min + Math.floor(random() * (max - min + 1)) }, () => pick(words)).join(' ');
  return Array.from({ length: count }, (_, i) => {
    const type = pick(DISTRACTOR_TYPES);
    return {
      key: `${type}/filler-${i}`,
      title: text(2, 5),
      summary: `${text(8, 14)}.`,
      body: `${text(30, 60)}.\n\n${text(20, 40)}.`,
      file: files[i % files.length]!.name,
    };
  });
}

/** Adds distractors through the core, like upsert, but without a tool call each. */
export async function addDistractors(session: GraphSession, count: number, words: string[], seed = 24): Promise<void> {
  const ctx = soloContext();
  for (const { key, title, summary, body } of distractorNodes(count, words, seed)) {
    await writeNode(ctx, session.store, { key, type: typeOf({ key }), title, summary, body });
  }
}

// --- lifecycle -------------------------------------------------------------

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Facts that change: the node is superseded by one with the new value. */
export const CHANGES = [
  { answer: 'concept/permission-cache', from: '5 minutes', to: '10 minutes' },
  { answer: 'concept/sso', from: '12 hours', to: '8 hours' },
  { answer: 'concept/rate-limits', from: '120 requests per minute', to: '240 requests per minute' },
  { answer: 'concept/deploys', from: '15 minutes', to: '30 minutes' },
  { answer: 'concept/email-delivery', from: 'Postmark', to: 'Amazon SES' },
];
export const DELETED = ['concept/audit-log', 'concept/pagination', 'concept/secrets'];
export const FLAGGED = ['concept/plans', 'concept/regions', 'concept/dunning'];

const questionFor = (key: string) => questions.find((q) => q.answer === key)!;
const searchFor = (session: GraphSession, key: string, extra: Record<string, unknown> = {}) =>
  session.call('search', { query: searchWords(questionFor(key).question).join(' '), level: 'title', ...extra });

/**
 * Supersedes, deletes and flags nodes on a seeded graph, then checks that no read
 * shows an old fact as if it were current. Changes the graph: use a fresh session.
 */
export async function lifecycle(session: GraphSession): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(ok ? {} : { detail }) });

  for (const c of CHANGES) {
    const old = nodes.find((n) => n.key === c.answer)!;
    const before = parseHits(await searchFor(session, c.answer)).findIndex((h) => h.key === c.answer);
    const swap = (text: string) => text.split(c.from).join(c.to);
    const out = await session.call('supersede', { old: c.answer, summary: swap(old.summary), body: swap(old.body) });
    const replacement = out.split(' ')[0]!;

    const hits = parseHits(await searchFor(session, c.answer));
    check(`${c.answer}: search leaves the old node out`, !hits.some((h) => h.key === c.answer), out);
    // The replacement should rank where the old node did, not lower.
    const at = hits.findIndex((h) => h.key === replacement);
    check(
      `${c.answer}: search ranks ${replacement} where the old node was`,
      at >= 0 && (before < 0 || at <= before),
      `rank ${at + 1}, was ${before + 1}`,
    );

    const history = parseHits(await searchFor(session, c.answer, { all_status: true }));
    const line = history.find((h) => h.key === c.answer)?.line ?? '';
    check(
      `${c.answer}: search with all_status marks it superseded`,
      !line || line.includes(`superseded by ${replacement}`),
      line,
    );
    for (const level of RENDER_LEVELS) {
      const text = await session.call('get', { keys: [c.answer], level });
      check(`${c.answer}: get at ${level} says superseded`, /superseded by/i.test(text), text.split('\n')[0]);
    }
    const fresh = await session.call('get', { keys: [replacement] });
    check(`${replacement}: get has the new value "${c.to}"`, fresh.includes(c.to) && !fresh.includes(c.from));
  }

  await session.call('delete', { keys: DELETED });
  for (const key of DELETED) {
    const hits = parseHits(await searchFor(session, key));
    check(`${key}: search leaves the deleted node out`, !hits.some((h) => h.key === key));
    const text = await session.call('get', { keys: [key] });
    check(`${key}: get says it was deleted`, text.includes('was deleted'), text);
  }

  await session.call('feedback', { keys: FLAGGED, verdict: 'outdated_or_wrong' });
  for (const key of FLAGGED) {
    const line = parseHits(await searchFor(session, key)).find((h) => h.key === key)?.line ?? '';
    check(`${key}: search flags it`, line.includes('flagged outdated or wrong'), line || 'not in results');
    const text = await session.call('get', { keys: [key] });
    check(`${key}: get flags it`, text.includes('Flagged outdated or wrong'), text.split('\n')[0]);
  }
  return checks;
}
