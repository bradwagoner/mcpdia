import type { Context } from '../context.js';
import { NODE_STATUSES, type GraphStore, type NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import type { RenderLevel } from './render.js';
import { openConflicts, supersededByKey } from './nodes.js';
import { normalizeNodeType, normalizeTag } from './vocabulary.js';

export interface SearchInput {
  query: string;
  type?: string;
  tag?: string;
  level: RenderLevel;
  limit: number;
  /** Include superseded and deleted nodes. */
  allStatus?: boolean;
}

export interface SearchHit {
  node: NodeRecord;
  edgeCount?: number;
  /** For partial matches: which query words this hit matched. */
  matched?: string[];
  /** Display key of the replacing node, for superseded hits. */
  supersededByKey?: string;
  /** Display key of an open starter-set conflict on this node. */
  conflictKey?: string;
}

export interface SearchOutput {
  query: string;
  /** The words searched for, after dropping question words. */
  terms: string[];
  hits: SearchHit[];
  total: number;
  /** How many hits, at the front, matched every word. The hits after them are partial matches. */
  fullMatches: number;
  /** No node matched every word, so these hits match only some of them. */
  partial: boolean;
  /** The type filter names a type no node has. */
  unknownType?: string;
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
 * Nodes matching every word come first. If they don't fill the limit and there were
 * several words, the rest is topped up with nodes matching any word (still ranked
 * by relevance), labelled with the words they matched (ADR 0021).
 */
export async function search(ctx: Context, store: GraphStore, input: SearchInput): Promise<SearchOutput> {
  const terms = searchTerms(input.query);
  if (terms.length === 0) throw new UserError('The query has no words to search for.');

  const base = {
    namespaces: ctx.namespaces,
    terms,
    type: input.type ? normalizeNodeType(input.type) : undefined,
    tag: input.tag ? normalizeTag(input.tag) : undefined,
    statuses: input.allStatus ? NODE_STATUSES : undefined,
    limit: input.limit,
  };
  const full = await store.search({ ...base, match: 'all' });
  let nodes = full.nodes;
  let total = full.total;
  // No minimum-match cutoff: FTS5 doesn't say how many words a row matched, so partial hits are labelled instead.
  if (nodes.length < input.limit && terms.length > 1) {
    const any = await store.search({ ...base, match: 'any', limit: input.limit + nodes.length });
    const shown = new Set(nodes.map((n) => n.id));
    nodes = [...nodes, ...any.nodes.filter((n) => !shown.has(n.id))].slice(0, input.limit);
    total = any.total;
  }
  const fullMatches = full.nodes.length;
  const partial = fullMatches === 0 && total > 0;

  let unknownType: SearchOutput['unknownType'];
  // stats() counts active nodes only, so it can't call a type unknown when deleted/superseded ones are searched too.
  if (total === 0 && base.type && !input.allStatus) {
    const used = (await store.stats(ctx.namespaces)).nodeTypes.map((t) => t.name);
    if (!used.includes(base.type)) unknownType = base.type;
  }

  // Which words each partial hit matched, one search per word, so the caller can judge relevance.
  const matched = new Map<string, string[]>();
  const ids = nodes.slice(fullMatches).map((n) => n.id);
  if (ids.length) {
    for (const term of terms) {
      const { nodes } = await store.search({ ...base, terms: [term], match: 'all', ids, limit: ids.length });
      for (const n of nodes) matched.set(n.id, [...(matched.get(n.id) ?? []), term]);
    }
  }

  const wantsCounts = input.level === 'summary' || input.level === 'snippet';
  const counts = wantsCounts ? await store.edgeCounts(nodes.map((n) => n.id)) : undefined;
  const conflicts = await openConflicts(ctx, store, nodes);
  return {
    query: input.query,
    terms,
    hits: await Promise.all(
      nodes.map(async (node, i) => ({
        node,
        edgeCount: counts?.get(node.id) ?? (wantsCounts ? 0 : undefined),
        matched: i >= fullMatches ? (matched.get(node.id) ?? []) : undefined,
        supersededByKey: await supersededByKey(ctx, store, node),
        conflictKey: conflicts.get(node.id),
      })),
    ),
    total,
    fullMatches,
    partial,
    unknownType,
  };
}
