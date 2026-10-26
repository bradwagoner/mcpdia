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
  /** Display key of an open starter-set conflict on the node (ADR 0026). */
  conflictKey?: string;
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
  if (extras.conflictKey) markers.push(`newer version in ${extras.conflictKey}`);
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
  if (extras.conflictKey) {
    lines.push(
      `The starter set changed this node after it was edited here; its version is in ${extras.conflictKey}. Compare, keep what's right, then delete ${extras.conflictKey} (or run the resolve-conflicts prompt).`,
    );
  }
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

  if (Object.keys(node.properties).length) lines.push(`Properties: ${JSON.stringify(sortKeys(node.properties))}`);
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
    .filter((t) => findWord(`${shown} ${head}`, t) < 0)
    .map((t) => findWord(flat, t))
    .filter((i) => i >= 0);
  if (hidden.length === 0) return `${head}…`;

  const at = Math.min(...hidden);
  const introEnd = wordEndBefore(flat, SNIPPET_INTRO);
  const from = Math.max(introEnd, at - SNIPPET_LEAD);
  const room = SNIPPET_LENGTH - SNIPPET_INTRO;
  // Inside a long word or URL, the nearest word boundary can lie past the match; cut mid-word instead.
  let start = wordStartAfter(flat, from);
  if (start > at) start = from;
  let end = wordEndBefore(flat, start + room);
  if (end <= at) end = Math.min(flat.length, start + room);
  const left = flat.length - introEnd - (end - start);
  return `${flat.slice(0, introEnd)} … ${flat.slice(start, end)}${end < flat.length ? ' …' : ''} (+${left} chars)`;
}

/**
 * Where `term` shows up as a word start. The search index also matches stemmed forms
 * ("permissions" finds "permission"), so if the term itself is missing, a few common
 * endings are stripped and tried too. A light match, not the index's own stemmer.
 */
function findWord(text: string, term: string): number {
  const at = wordIndex(text, term);
  if (at >= 0) return at;
  for (const ending of ['ing', 'ed', 'es', 's']) {
    const stem = term.slice(0, -ending.length);
    if (term.toLowerCase().endsWith(ending) && stem.length >= 3) {
      const i = wordIndex(text, stem);
      if (i >= 0) return i;
    }
  }
  return -1;
}

/** Where a word starting with `term` begins: any case, `_` and punctuation break words. */
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

/** Object keys sorted at every depth, arrays kept in order, so every store renders the same text. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
  );
}
