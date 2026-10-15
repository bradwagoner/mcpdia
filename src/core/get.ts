import type { Context } from '../context.js';
import type { GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { displayKey, parseRef } from './keys.js';
import { findNode, supersededByKey } from './nodes.js';
import { searchTerms } from './search.js';
import { getSetting } from './settings.js';

export const MAX_NEIGHBORS = 20;

export interface GetInput {
  keys: string[];
  neighbors: boolean;
}

export interface NeighborView {
  direction: 'out' | 'in';
  type: string;
  /** Display key of the other end. */
  key: string;
  /** null when the other end does not exist (yet). */
  node: NodeRecord | null;
}

export type GetItem =
  | {
      ref: string;
      node: NodeRecord;
      supersededByKey?: string;
      neighbors?: NeighborView[];
      /** Neighbors beyond MAX_NEIGHBORS that were left out. */
      moreNeighbors?: number;
    }
  | { ref: string; node: null; suggestion?: string };

export async function get(ctx: Context, store: GraphStore, input: GetInput): Promise<GetItem[]> {
  const max = await getSetting(store, ctx, 'get.max_keys');
  if (input.keys.length === 0) throw new UserError('Pass at least one key.');
  if (input.keys.length > max) {
    throw new UserError(
      `Too many keys: ${input.keys.length}. get takes up to ${max} per call.`,
      'Split them across calls.',
    );
  }

  const items: GetItem[] = [];
  for (const ref of input.keys) {
    const node = await findNode(ctx, store, parseRef(ctx, ref));
    if (!node || node.status === 'deleted') {
      items.push({ ref, node: null, suggestion: await suggestFor(ctx, store, ref) });
      continue;
    }
    const item: GetItem = { ref, node, supersededByKey: await supersededByKey(ctx, store, node) };
    if (input.neighbors) {
      // Links can cross namespaces; only show the ends the caller can read.
      const readable = (await store.neighbors(node.id)).filter((n) => ctx.namespaces.includes(n.otherNamespace));
      const all = readable.map((n): NeighborView => ({
        direction: n.direction,
        type: n.edge.type,
        key: displayKey(ctx, n.otherNamespace, n.otherKey),
        node: n.other,
      }));
      item.neighbors = all.slice(0, MAX_NEIGHBORS);
      item.moreNeighbors = Math.max(0, all.length - MAX_NEIGHBORS);
    }
    items.push(item);
  }
  return items;
}

/**
 * "Did you mean" from a quick search on the key's words. Each word is cut to
 * a short prefix so a typo past the first few letters still matches.
 */
async function suggestFor(ctx: Context, store: GraphStore, ref: string): Promise<string | undefined> {
  const terms = searchTerms(ref.replace(/^[^/]*\//, '')).map((t) => t.slice(0, 4));
  if (terms.length === 0) return undefined;
  const { nodes } = await store.search({ namespaces: ctx.namespaces, terms, match: 'any', prefix: true, limit: 1 });
  const hit = nodes[0];
  return hit ? displayKey(ctx, hit.namespace, hit.key) : undefined;
}
