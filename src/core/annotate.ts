import type { Context } from '../context.js';
import type { GraphStore, NodeRecord } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { displayKey, slugify, uniqueKey } from './keys.js';
import { requireActive } from './nodes.js';

export const NOTE_TYPE = 'note';
export const COMMENTS_ON = 'comments_on';
const TITLE_LENGTH = 80;

export interface AnnotateInput {
  /** Key of the node the note is about. */
  on: string;
  text: string;
  /** Defaults to the first line of the text. */
  title?: string;
}

export interface AnnotateOutput {
  note: NodeRecord;
  noteKey: string;
  onKey: string;
}

/**
 * Leaves a note about a node (ADR 0008): a new `note` node with a key built
 * from its text, the caller as author, and a `comments_on` edge to the
 * target. The target's body and version are untouched.
 */
export async function annotate(ctx: Context, store: GraphStore, input: AnnotateInput): Promise<AnnotateOutput> {
  const text = input.text.trim();
  if (!text) throw new UserError('text is empty.');
  const target = await requireActive(ctx, store, input.on);

  const title = (input.title?.trim() || firstLine(text)).slice(0, TITLE_LENGTH);
  const namespace = ctx.writeNamespace;
  // Notes are many and never meant to merge, so a clash just takes a suffix (ADR 0012).
  const key = await uniqueKey(
    `${NOTE_TYPE}/${slugify(title)}`,
    async (k) => (await store.getNode(namespace, k)) !== null,
  );

  const note = await store.createNode({
    namespace,
    key,
    type: NOTE_TYPE,
    title,
    summary: null,
    body: text === title ? null : text,
    properties: {},
    aliases: [],
    tags: [],
    source: 'local',
    author: ctx.caller,
  });
  await store.upsertEdge({
    fromNamespace: note.namespace,
    fromKey: note.key,
    toNamespace: target.namespace,
    toKey: target.key,
    type: COMMENTS_ON,
    note: null,
    source: 'local',
    author: ctx.caller,
  });
  return {
    note,
    noteKey: displayKey(ctx, note.namespace, note.key),
    onKey: displayKey(ctx, target.namespace, target.key),
  };
}

function firstLine(text: string): string {
  return text.split('\n')[0]!.trim();
}
