import type { Context } from '../context.js';
import type { GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { displayKey, parseRef, type Ref } from './keys.js';

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
  throw new UserError(`Not found: ${input}.`, 'search for its key.');
}

/** The namespace a write to `ref` lands in; must be one the caller can see. */
export function writableNamespace(ctx: Context, ref: Ref & { kind: 'key' }): string {
  if (!ctx.namespaces.includes(ref.namespace)) {
    throw new UserError(`Namespace ${ref.namespace} is not loaded.`, `Loaded: ${ctx.namespaces.join(', ')}.`);
  }
  return ref.namespace;
}

/** Display key of whatever replaced a superseded node. */
export async function supersededByKey(ctx: Context, store: GraphStore, node: NodeRecord): Promise<string | undefined> {
  if (node.status !== 'superseded' || !node.supersededBy) return undefined;
  const next = await store.getNodeById(node.supersededBy);
  return next ? displayKey(ctx, next.namespace, next.key) : undefined;
}
