import type { Context } from '../context.js';
import { VersionConflictError, type GraphStore, type NodePatch, type NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { cleanKey, displayKey, parseRef, suggestKey, uniqueKey } from './keys.js';
import { findNode, supersededByKey, writableNamespace } from './nodes.js';
import { normalizeAlias, normalizeNodeType, normalizeTag, STARTER_NODE_TYPES, suggestType } from './vocabulary.js';

export interface UpsertInput {
  /** Omit to create a new node with a key built from type and title. */
  key?: string;
  type: string;
  title: string;
  summary?: string;
  body?: string;
  tags?: string[];
  aliases?: string[];
  properties?: Record<string, unknown>;
  /** Apply only if the node is still at this version (optimistic concurrency). */
  version?: number;
}

export interface UpsertOutput {
  node: NodeRecord;
  created: boolean;
  /** "Did you mean" for a type that is new to this graph. */
  typeHint?: string;
}

export async function upsert(ctx: Context, store: GraphStore, input: UpsertInput): Promise<UpsertOutput> {
  const type = normalizeNodeType(input.type);
  if (!type) throw new UserError('type is empty.');
  const title = input.title.trim();
  if (!title) throw new UserError('title is empty.');

  const fields = {
    type,
    title,
    summary: input.summary?.trim() || null,
    body: input.body ?? null,
    properties: input.properties ?? {},
    aliases: unique((input.aliases ?? []).map(normalizeAlias)),
    tags: unique((input.tags ?? []).map(normalizeTag)),
  };
  const typeHint = await typeSuggestion(ctx, store, type);

  if (input.key !== undefined) {
    const ref = parseRef(ctx, cleanKey(input.key));
    const existing = await findNode(ctx, store, ref);
    if (existing) return { node: await update(ctx, store, existing, input, fields), created: false, typeHint };
    if (ref.kind === 'id') throw new UserError(`Not found: ${ref.id}.`, 'Pass a key to create a node.');
    const namespace = writableNamespace(ctx, ref);
    if (!ref.key) throw new UserError('key is empty.');
    const node = await store.createNode({ ...fields, namespace, key: ref.key, source: 'local', author: ctx.caller });
    return { node, created: true, typeHint };
  }

  // No key: build one from the title, and stop short of writing over a node that looks like the same thing.
  const namespace = ctx.writeNamespace;
  const base = suggestKey(type, title);
  const clash = await store.getNode(namespace, base);
  if (clash?.status === 'active') {
    throw new UserError(
      `${displayKey(ctx, namespace, base)} already exists: "${clash.title}".`,
      `To update it, pass key: ${displayKey(ctx, namespace, base)}. To add a separate node, pass a different key.`,
    );
  }
  const key = await uniqueKey(base, async (k) => (await store.getNode(namespace, k)) !== null);
  const node = await store.createNode({ ...fields, namespace, key, source: 'local', author: ctx.caller });
  return { node, created: true, typeHint };
}

async function update(
  ctx: Context,
  store: GraphStore,
  existing: NodeRecord,
  input: UpsertInput,
  fields: Required<NodePatch>,
): Promise<NodeRecord> {
  const shown = displayKey(ctx, existing.namespace, existing.key);
  if (existing.status === 'deleted') throw new UserError(`${shown} was deleted.`, 'Use a different key.');
  if (existing.status === 'superseded') {
    const next = await supersededByKey(ctx, store, existing);
    throw new UserError(
      `${shown} is superseded${next ? ` by ${next}` : ''}.`,
      next ? `Update ${next} instead.` : undefined,
    );
  }

  // Only what the caller passed changes; type and title are always passed.
  const patch: NodePatch = { type: fields.type, title: fields.title };
  if (input.summary !== undefined) patch.summary = fields.summary;
  if (input.body !== undefined) patch.body = fields.body;
  if (input.properties !== undefined) patch.properties = fields.properties;
  if (input.aliases !== undefined) patch.aliases = fields.aliases;
  if (input.tags !== undefined) patch.tags = fields.tags;

  try {
    return await store.updateNode(existing.id, patch, ctx.caller, input.version);
  } catch (err) {
    if (err instanceof VersionConflictError) {
      throw new UserError(
        `${shown} changed: it is at v${err.current.version}, not v${input.version}.`,
        'get it again and re-apply your change.',
      );
    }
    throw err;
  }
}

async function typeSuggestion(ctx: Context, store: GraphStore, type: string): Promise<string | undefined> {
  const used = (await store.stats(ctx.namespaces)).nodeTypes.map((t) => t.name);
  if (used.includes(type)) return undefined;
  const near = suggestType(type, unique([...used, ...STARTER_NODE_TYPES]));
  return near ? `Type "${type}" is new here. Did you mean "${near}"?` : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
