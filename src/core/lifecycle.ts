import type { Context } from '../context.js';
import type { FeedbackVerdict, GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { cleanKey, displayKey, parseRef, suggestKey, uniqueKey } from './keys.js';
import { COMMENTS_ON } from './annotate.js';
import { findNode, requireActive, supersededByKey } from './nodes.js';
import { writeNode, type NodeWrite } from './upsert.js';
import { normalizeNodeType } from './vocabulary.js';

/** Calls that touch several nodes take a short list, like `get`. */
export const MAX_BATCH = 50;

export const SUPERSEDES = 'supersedes';

// --- supersede -----------------------------------------------------------

export interface SupersedeInput {
  /** The node being replaced. */
  old: string;
  /** Key of the replacement. Omit to create one from type and title. */
  new?: string;
  type?: string;
  title?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  aliases?: string[];
}

export interface SupersedeOutput {
  oldKey: string;
  newKey: string;
  replacement: NodeRecord;
  created: boolean;
  movedEdges: number;
  typeHint?: string;
}

/**
 * "This replaces that" (ADR 0008): creates or updates the replacement, marks
 * the old node superseded with a pointer, moves its edges to the replacement,
 * and links replacement → supersedes → old so the history stays visible.
 */
export async function supersede(ctx: Context, store: GraphStore, input: SupersedeInput): Promise<SupersedeOutput> {
  const old = await requireActive(ctx, store, input.old);
  const hasContent = [input.type, input.title, input.summary, input.body, input.tags, input.aliases].some(
    (v) => v !== undefined,
  );

  let result: NodeWrite;
  const existing = input.new ? await findNode(ctx, store, parseRef(ctx, cleanKey(input.new))) : null;
  if (existing?.id === old.id) throw new UserError('A node cannot supersede itself.');
  if (existing && !hasContent) {
    if (existing.status !== 'active') throw new UserError(`${input.new} is not active.`);
    result = { node: existing, created: false };
  } else {
    const type = normalizeNodeType(input.type ?? existing?.type ?? old.type);
    const title = input.title ?? existing?.title ?? old.title;
    // Without a key, the replacement often has the old title, so take a suffixed key rather than clash.
    const key =
      input.new ??
      (await uniqueKey(suggestKey(type, title), async (k) => (await store.getNode(ctx.writeNamespace, k)) !== null));
    const { summary, body, tags, aliases } = input;
    result = await writeNode(ctx, store, { key, type, title, summary, body, tags, aliases });
  }

  const replacement = result.node;

  const movedEdges = await store.repointEdges(old.id, replacement);
  await store.setStatus(old.id, 'superseded', ctx.caller, replacement.id);
  await store.upsertEdge({
    fromNamespace: replacement.namespace,
    fromKey: replacement.key,
    toNamespace: old.namespace,
    toKey: old.key,
    type: SUPERSEDES,
    note: null,
    source: 'local',
    author: ctx.caller,
  });
  return {
    oldKey: displayKey(ctx, old.namespace, old.key),
    newKey: displayKey(ctx, replacement.namespace, replacement.key),
    replacement,
    created: result.created,
    movedEdges,
    typeHint: result.typeHint,
  };
}

// --- verify, delete, feedback ------------------------------------------

export interface BatchOutput {
  done: string[];
  notFound: string[];
  /** Superseded keys the operation skipped, each with its replacement. */
  superseded: string[];
  /** Keys of nodes that were already deleted. */
  deleted: string[];
}

/** "I checked and it is still right": bumps last_verified_at. */
export async function verify(ctx: Context, store: GraphStore, keys: string[]): Promise<BatchOutput> {
  const { nodes, out } = await resolveBatch(ctx, store, keys);
  await store.markVerified(
    nodes.map((n) => n.id),
    new Date().toISOString(),
  );
  return out;
}

export interface DeleteOutput extends BatchOutput {
  /** Live nodes that still link to a deleted one: those links now lead nowhere. */
  dangling: { key: string; from: string[] }[];
}

/** Soft delete only: the node and its history stay in the store. */
export async function softDelete(ctx: Context, store: GraphStore, keys: string[]): Promise<DeleteOutput> {
  const { nodes, out } = await resolveBatch(ctx, store, keys);
  const dangling: DeleteOutput['dangling'] = [];
  const gone = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    await store.setStatus(node.id, 'deleted', ctx.caller);
    const from = (await store.neighbors(node.id))
      // Notes go with the node they comment on, so they don't count as dangling.
      .filter((n) => n.direction === 'in' && n.edge.type !== COMMENTS_ON && n.other && !gone.has(n.other.id))
      .filter((n) => ctx.namespaces.includes(n.otherNamespace))
      .map((n) => `${displayKey(ctx, n.otherNamespace, n.otherKey)} (${n.edge.type})`);
    if (from.length) dangling.push({ key: displayKey(ctx, node.namespace, node.key), from });
  }
  return { ...out, dangling };
}

export async function feedback(
  ctx: Context,
  store: GraphStore,
  keys: string[],
  verdict: FeedbackVerdict,
): Promise<BatchOutput> {
  // Superseded nodes still show up in get, so they can still be marked outdated.
  const { nodes, out } = await resolveBatch(ctx, store, keys, true);
  await store.recordFeedback(
    nodes.map((n) => n.id),
    verdict,
    new Date().toISOString(),
  );
  return out;
}

/**
 * Active nodes (plus superseded ones when allowed) for a list of keys. Unknown
 * keys are reported, not fatal; a superseded key names its replacement.
 */
async function resolveBatch(ctx: Context, store: GraphStore, keys: string[], allowSuperseded = false) {
  if (keys.length === 0) throw new UserError('Pass at least one key.');
  if (keys.length > MAX_BATCH) throw new UserError(`Too many keys: ${keys.length}. Up to ${MAX_BATCH} per call.`);
  const nodes: NodeRecord[] = [];
  const out: BatchOutput = { done: [], notFound: [], superseded: [], deleted: [] };
  for (const key of keys) {
    const node = await findNode(ctx, store, parseRef(ctx, key));
    const usable = node?.status === 'active' || (allowSuperseded && node?.status === 'superseded');
    if (node && usable) {
      if (nodes.some((n) => n.id === node.id)) continue;
      nodes.push(node);
      out.done.push(displayKey(ctx, node.namespace, node.key));
    } else if (node?.status === 'superseded') {
      const by = await supersededByKey(ctx, store, node);
      out.superseded.push(by ? `${key} (now ${by})` : key);
    } else if (node?.status === 'deleted') {
      out.deleted.push(key);
    } else {
      out.notFound.push(key);
    }
  }
  return { nodes, out };
}
