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
}

/** Words only: FTS5 operators and punctuation in the query are ignored. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Every word must match; if that finds nothing and there were several words,
 * any word may match (still ranked by relevance).
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
  if (result.total === 0 && terms.length > 1) result = await store.search({ ...base, match: 'any' });

  const wantsCounts = input.level === 'summary' || input.level === 'snippet';
  const counts = wantsCounts ? await store.edgeCounts(result.nodes.map((n) => n.id)) : undefined;
  return {
    query: input.query,
    hits: result.nodes.map((node) => ({ node, edgeCount: counts?.get(node.id) ?? (wantsCounts ? 0 : undefined) })),
    total: result.total,
  };
}
