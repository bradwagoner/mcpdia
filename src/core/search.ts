import type { Context } from '../context.js';
import type { GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import type { RenderLevel } from './render.js';
import { normalizeNodeType, normalizeTag } from './vocabulary.js';

export interface SearchInput {
  query: string;
  type?: string;
  tag?: string;
  level: RenderLevel;
  limit: number;
}

export interface SearchHit {
  node: NodeRecord;
  edgeCount?: number;
}

export interface SearchOutput {
  query: string;
  hits: SearchHit[];
  total: number;
  /** No node matched every word, so these hits match only some of them. */
  partial: boolean;
}

/**
 * Question words that match almost everything and rank nothing, so "what is
 * left for v0.1" searches for "left v0 1". Kept when they are all there is.
 */
const STOP_WORDS = new Set(
  (
    'a an and are about at be by can did do does for from how i in is it of on or should ' +
    'the there this to was we were what when where which who why with you'
  ).split(' '),
);

/** Words only: FTS5 operators and punctuation in the query are ignored, and so are stop words. */
export function searchTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const content = words.filter((w) => !STOP_WORDS.has(w));
  return content.length ? content : words;
}

/**
 * Every word must match; if that finds nothing and there were several words,
 * any word may match (still ranked by relevance) and the output says so.
 */
export async function search(ctx: Context, store: GraphStore, input: SearchInput): Promise<SearchOutput> {
  const terms = searchTerms(input.query);
  if (terms.length === 0) throw new UserError('The query has no words to search for.');

  const base = {
    namespaces: ctx.namespaces,
    terms,
    type: input.type ? normalizeNodeType(input.type) : undefined,
    tag: input.tag ? normalizeTag(input.tag) : undefined,
    limit: input.limit,
  };
  let result = await store.search({ ...base, match: 'all' });
  let partial = false;
  // QUESTION(KAN-13): a minimum-match cutoff (say, at least half the words) would drop
  // one-word hits from long queries, but FTS5 does not report how many terms a row
  // matched. Worth a per-term count query, or is the "partial" label enough?
  if (result.total === 0 && terms.length > 1) {
    result = await store.search({ ...base, match: 'any' });
    partial = result.total > 0;
  }

  const wantsCounts = input.level === 'summary' || input.level === 'snippet';
  const counts = wantsCounts ? await store.edgeCounts(result.nodes.map((n) => n.id)) : undefined;
  return {
    query: input.query,
    hits: result.nodes.map((node) => ({ node, edgeCount: counts?.get(node.id) ?? (wantsCounts ? 0 : undefined) })),
    total: result.total,
    partial,
  };
}
