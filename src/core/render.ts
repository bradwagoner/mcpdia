import type { Context } from '../context.js';
import type { NodeRecord } from '../store/GraphStore.js';
import { displayKey } from './keys.js';

/**
 * Render levels (ADR 0004) as compact text (ADR 0011): one line per result,
 * no field names or quotes, empty fields left out. Each level adds to the one before.
 */

export const RENDER_LEVELS = ['title', 'summary', 'snippet', 'full'] as const;
export type RenderLevel = (typeof RENDER_LEVELS)[number];

export const SNIPPET_LENGTH = 300;

export interface RenderExtras {
  edgeCount?: number;
  /** Display key of the replacing node, for superseded nodes. */
  supersededByKey?: string;
  /** Query words a partial search hit matched. */
  matched?: string[];
}

/**
 * Someone marked the node outdated or wrong, and nobody has edited or verified it since.
 * An edit or a verify clears the warning; the count stays on record.
 */
export function flaggedWrong(node: NodeRecord): boolean {
  return node.lastWrongAt !== null;
}

/** `concept/permissions [concept] Permission system` */
export function titleLine(ctx: Context, node: NodeRecord): string {
  return `${displayKey(ctx, node.namespace, node.key)} [${node.type}] ${node.title}`;
}

/**
 * A node as one list entry: the title line, plus indented detail lines
 * for `summary` and `snippet`. `full` falls through to renderFull.
 */
export function renderStub(ctx: Context, node: NodeRecord, level: RenderLevel, extras: RenderExtras = {}): string {
  if (level === 'full') return renderFull(ctx, node, extras);
  const markers: string[] = [];
  if (node.status === 'deleted') markers.push('deleted');
  if (extras.supersededByKey) markers.push(`superseded by ${extras.supersededByKey}`);
  if (flaggedWrong(node)) markers.push('flagged outdated or wrong');
  if (extras.matched?.length) markers.push(`matched: ${extras.matched.join(', ')}`);
  const lines = [titleLine(ctx, node) + (markers.length ? ` (${markers.join('; ')})` : '')];
  if (level === 'summary' || level === 'snippet') lines.push(`  ${summaryLine(node, extras)}`);
  if (level === 'snippet' && node.body) lines.push(`  ${snippet(node.body)}`);
  return lines.join('\n');
}

/** `Roles grant actions; groups hold roles. · 4 links · verified 2026-09-30` */
export function summaryLine(node: NodeRecord, extras: RenderExtras): string {
  const parts: string[] = [];
  if (node.summary) parts.push(node.summary);
  if (extras.edgeCount !== undefined) parts.push(plural(extras.edgeCount, 'link'));
  parts.push(node.lastVerifiedAt ? `verified ${day(node.lastVerifiedAt)}` : 'never verified');
  return parts.join(' · ');
}

export function renderFull(ctx: Context, node: NodeRecord, extras: RenderExtras = {}): string {
  const meta = [`v${node.version}`, `updated ${day(node.updatedAt)}`];
  if (node.lastVerifiedAt) meta.push(`verified ${day(node.lastVerifiedAt)}`);
  const lines = [`${titleLine(ctx, node)}   ${meta.join(' · ')}`];
  if (node.status === 'deleted') lines.push(`Deleted on ${day(node.updatedAt)}. Upsert this key to restore it.`);
  if (extras.supersededByKey) lines.push(`Superseded by ${extras.supersededByKey}`);
  if (flaggedWrong(node)) {
    lines.push(
      `Flagged outdated or wrong on ${day(node.lastWrongAt!)}. Check it before relying on it; fix it with upsert, or verify it if it is still right.`,
    );
  }
  if (extras.matched?.length) lines.push(`Matched: ${extras.matched.join(', ')}`);
  if (node.summary) lines.push(node.summary);

  const labels: string[] = [];
  if (node.tags.length) labels.push(`Tags: ${node.tags.join(', ')}`);
  if (node.aliases.length) labels.push(`Aliases: ${node.aliases.join(', ')}`);
  if (labels.length) lines.push(labels.join('   '));

  if (Object.keys(node.properties).length) lines.push(`Properties: ${JSON.stringify(node.properties)}`);
  if (node.body) lines.push('', node.body);
  return lines.join('\n');
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function snippet(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH)}…` : flat;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
