import type { Context } from '../context.js';
import type { GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { displayKey, parseRef } from './keys.js';
import { findNode, openConflicts, supersededByKey } from './nodes.js';
import { getSetting } from './settings.js';

export const MAX_NEIGHBORS = 20;

export interface GetInput {
  keys: string[];
  neighbors: boolean;
  /** Return deleted nodes too, instead of "was deleted". */
  allStatus?: boolean;
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
      /** Display key of an open starter-set conflict on this node. */
      conflictKey?: string;
      neighbors?: NeighborView[];
      /** Neighbors beyond MAX_NEIGHBORS that were left out. */
      moreNeighbors?: number;
    }
  | { ref: string; node: null; deleted?: boolean };

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
    if (!node || (node.status === 'deleted' && !input.allStatus)) {
      items.push({ ref, node: null, deleted: node !== null });
      continue;
    }
    const conflict = (await openConflicts(ctx, store, [node])).get(node.id);
    const item: GetItem = { ref, node, supersededByKey: await supersededByKey(ctx, store, node) };
    if (conflict) item.conflictKey = conflict;
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
