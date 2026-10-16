import type { Context } from '../context.js';
import type { EdgeRecord, GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { displayKey, parseRef } from './keys.js';
import { findNode, supersededByKey, writableNamespace } from './nodes.js';
import { normalizeEdgeType, PARENT_EDGE_TYPES, STARTER_EDGE_TYPES, suggestType } from './vocabulary.js';

export interface LinkInput {
  from: string;
  to: string;
  type: string;
  note?: string;
}

export interface LinkOutput {
  edge: EdgeRecord;
  created: boolean;
  fromKey: string;
  toKey: string;
  /** The target does not exist yet; the edge resolves when it is created (ADR 0007). */
  toMissing: boolean;
  typeHint?: string;
  /** The target was deleted or superseded, or the link closes a loop of parents. */
  targetHint?: string;
}

/** How far up the parents a loop check walks. */
const LOOP_SCAN = 100;

/** Where a link points. The target may not exist yet: edges are late-bound, so store its namespace and key. */
export async function linkTarget(ctx: Context, store: GraphStore, ref: string) {
  const toRef = parseRef(ctx, ref);
  const toNode = await findNode(ctx, store, toRef);
  let to: { namespace: string; key: string };
  if (toNode) to = { namespace: toNode.namespace, key: toNode.key };
  else if (toRef.kind === 'key') to = { namespace: writableNamespace(ctx, toRef), key: toRef.key };
  else throw new UserError(`Not found: ${toRef.id}.`, 'Link to a key instead; it can be created later.');
  return { to, toNode };
}

export async function link(ctx: Context, store: GraphStore, input: LinkInput): Promise<LinkOutput> {
  const type = normalizeEdgeType(input.type);
  if (!type) throw new UserError('type is empty.');

  const from = await findNode(ctx, store, parseRef(ctx, input.from));
  if (from?.status === 'deleted') throw new UserError(`${input.from} was deleted.`, 'Link from a current node.');
  if (!from) throw new UserError(`Not found: ${input.from}.`, 'Create it with upsert first, or search for its key.');

  const { to, toNode } = await linkTarget(ctx, store, input.to);

  const used = (await store.stats(ctx.namespaces)).edgeTypes.map((t) => t.name);
  const near = used.includes(type) ? null : suggestType(type, [...new Set([...used, ...STARTER_EDGE_TYPES])]);

  const { edge, created } = await store.upsertEdge({
    fromNamespace: from.namespace,
    fromKey: from.key,
    toNamespace: to.namespace,
    toKey: to.key,
    type,
    note: input.note?.trim() || null,
    source: 'local',
    author: ctx.caller,
  });
  return {
    edge,
    created,
    fromKey: displayKey(ctx, from.namespace, from.key),
    toKey: displayKey(ctx, to.namespace, to.key),
    toMissing: !toNode,
    typeHint: near ? `Edge type "${type}" is new here. Did you mean "${near}"?` : undefined,
    targetHint: await targetHint(ctx, store, from, toNode, type),
  };
}

async function targetHint(
  ctx: Context,
  store: GraphStore,
  from: NodeRecord,
  to: NodeRecord | null,
  type: string,
): Promise<string | undefined> {
  if (!to) return undefined;
  const toKey = displayKey(ctx, to.namespace, to.key);
  if (to.status === 'deleted')
    return `${toKey} was deleted, so this link leads nowhere. Link to a current node instead.`;
  const next = await supersededByKey(ctx, store, to);
  if (next) return `${toKey} is superseded by ${next}. Link to ${next} if you meant the current one.`;
  if (!PARENT_EDGE_TYPES.includes(type)) return undefined;
  if (from.id === to.id) return `This makes a loop: ${toKey} would sit under itself.`;
  if (await isAbove(store, from.id, to.id)) {
    return `This makes a loop: ${toKey} already sits under ${displayKey(ctx, from.namespace, from.key)}.`;
  }
  return undefined;
}

/** Whether `ancestor` is reachable from `id` by following parent edges up. */
async function isAbove(store: GraphStore, ancestor: string, id: string): Promise<boolean> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length && seen.size < LOOP_SCAN) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const n of await store.neighbors(current)) {
      if (n.direction !== 'out' || !PARENT_EDGE_TYPES.includes(n.edge.type) || !n.other) continue;
      if (n.other.id === ancestor) return true;
      queue.push(n.other.id);
    }
  }
  return false;
}
