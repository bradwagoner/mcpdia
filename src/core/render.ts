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
/** A searched word past the cut gets this much intro, then the rest of the length around the word (ADR 0020). */
export const SNIPPET_INTRO = 100;
/** The window around the word starts about this far before it, so the lead-in shows too. */
const SNIPPET_LEAD = 80;

export interface RenderExtras {
  edgeCount?: number;
  /** Display key of the replacing node, for superseded nodes. */
  supersededByKey?: string;
  /** Query words a partial search hit matched. */
  matched?: string[];
  /** Search words. A snippet shows the text around the first one that would otherwise be cut off. */
  terms?: string[];
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
  if (level === 'snippet' && node.body) {
    lines.push(`  ${snippet(node.body, extras.terms, `${node.title} ${node.summary ?? ''}`)}`);
  }
  return lines.join('\n');
}

/** `Roles grant actions; groups hold roles. · 4 links · verified 2026-09-30` */
export function summaryLine(node: NodeRecord, extras: RenderExtras): string {
  const parts: string[] = [];
  if (node.summary) parts.push(node.summary);
  if (extras.edgeCount !== undefined) parts.push(plural(extras.edgeCount, 'link'));
  if (node.lastVerifiedAt) parts.push(`verified ${day(node.lastVerifiedAt)}`);
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

/**
 * The first SNIPPET_LENGTH characters of the body. If a search word shows up only past that
 * (not in the title, summary or the first part), the snippet is a short intro plus the text
 * around that word instead, cut at whole words, with a count of what was left out.
 */
export function snippet(body: string, terms: string[] = [], shown = ''): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_LENGTH) return flat;
  const head = flat.slice(0, SNIPPET_LENGTH);

  const hidden = terms
    .filter((t) => wordIndex(`${shown} ${head}`, t) < 0)
    .map((t) => wordIndex(flat, t))
    .filter((i) => i >= 0);
  if (hidden.length === 0) return `${head}…`;

  const introEnd = wordEndBefore(flat, SNIPPET_INTRO);
  const start = wordStartAfter(flat, Math.max(introEnd, Math.min(...hidden) - SNIPPET_LEAD));
  const end = wordEndBefore(flat, start + SNIPPET_LENGTH - SNIPPET_INTRO);
  const left = flat.length - introEnd - (end - start);
  return `${flat.slice(0, introEnd)} … ${flat.slice(start, end)}${end < flat.length ? ' …' : ''} (+${left} chars)`;
}

/** Where a word starting with `term` begins, matching like the search index: any case, `_` and punctuation break words. */
function wordIndex(text: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.search(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, 'iu'));
}

/** `at`, moved back to the end of the word it falls in. */
function wordEndBefore(text: string, at: number): number {
  if (at >= text.length) return text.length;
  const space = text.lastIndexOf(' ', at);
  return space > 0 ? space : at;
}

/** `at`, moved forward to the start of the next word unless it already starts one. */
function wordStartAfter(text: string, at: number): number {
  if (at <= 0 || text[at - 1] === ' ') return at;
  const space = text.indexOf(' ', at);
  return space < 0 ? at : space + 1;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
