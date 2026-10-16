import type { Context } from '../context.js';
import type { EdgeRecord, GraphStore } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { displayKey, parseRef } from './keys.js';
import { findNode, writableNamespace } from './nodes.js';
import { normalizeEdgeType, STARTER_EDGE_TYPES, suggestType } from './vocabulary.js';

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
}

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
  if (!from || from.status === 'deleted') {
    throw new UserError(`Not found: ${input.from}.`, 'Create it with upsert first, or search for its key.');
  }

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
    toMissing: !toNode || toNode.status === 'deleted',
    typeHint: near ? `Edge type "${type}" is new here. Did you mean "${near}"?` : undefined,
  };
}
