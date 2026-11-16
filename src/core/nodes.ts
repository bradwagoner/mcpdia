import type { Context } from '../context.js';
import type { GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { displayKey, parseRef, type Ref } from './keys.js';
import { CONFLICTS_WITH } from './starters.js';

/** Looks a ref up and hides nodes outside the caller's namespaces. Any status. */
export async function findNode(ctx: Context, store: GraphStore, ref: Ref): Promise<NodeRecord | null> {
  const node = ref.kind === 'id' ? await store.getNodeById(ref.id) : await store.getNode(ref.namespace, ref.key);
  return node && ctx.namespaces.includes(node.namespace) ? node : null;
}

/** The active node a caller named, or a "not found" UserError. */
export async function requireActive(ctx: Context, store: GraphStore, input: string): Promise<NodeRecord> {
  const node = await findNode(ctx, store, parseRef(ctx, input));
  if (node?.status === 'active') return node;
  if (node?.status === 'superseded') {
    const next = await supersededByKey(ctx, store, node);
    throw new UserError(
      `${input} is superseded${next ? ` by ${next}` : ''}.`,
      next ? `Use ${next} instead.` : undefined,
    );
  }
  if (node?.status === 'deleted')
    throw new UserError(`${input} was deleted.`, 'Upsert its key to restore it, or search for a current node.');
  throw new UserError(`Not found: ${input}.`, 'search for its key.');
}

/** The namespace a write to `ref` lands in; must be one the caller can see. */
export function writableNamespace(ctx: Context, ref: Ref & { kind: 'key' }): string {
  if (!ctx.namespaces.includes(ref.namespace)) {
    throw new UserError(`Namespace ${ref.namespace} is not loaded.`, `Loaded: ${ctx.namespaces.join(', ')}.`);
  }
  return ref.namespace;
}

/**
 * Open starter-set conflicts on these nodes (ADR 0026): node id → display key of
 * the conflict node. Conflicts live in starter namespaces, so a caller reading
 * only its own namespace skips the query.
 */
export async function openConflicts(
  ctx: Context,
  store: GraphStore,
  nodes: NodeRecord[],
): Promise<Map<string, string>> {
  if (ctx.namespaces.length === 1 || nodes.length === 0) return new Map();
  const into = await store.linksInto(
    nodes.map((n) => n.id),
    CONFLICTS_WITH,
  );
  const out = new Map<string, string>();
  for (const [id, from] of into) {
    const visible = from.find((f) => ctx.namespaces.includes(f.namespace));
    if (visible) out.set(id, displayKey(ctx, visible.namespace, visible.key));
  }
  return out;
}

/** Display key of whatever replaced a superseded node. */
export async function supersededByKey(ctx: Context, store: GraphStore, node: NodeRecord): Promise<string | undefined> {
  if (node.status !== 'superseded' || !node.supersededBy) return undefined;
  const next = await store.getNodeById(node.supersededBy);
  return next ? displayKey(ctx, next.namespace, next.key) : undefined;
}
