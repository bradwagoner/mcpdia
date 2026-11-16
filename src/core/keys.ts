import type { Context } from '../context.js';
import { isUlid } from '../ulid.js';

/**
 * Keys are `<type>/<slug>`, built from words rather than random ids so they
 * are cheap to tokenize and mean something to the model (ADR 0012).
 */

const MAX_SLUG_WORDS = 6;
const MAX_SLUG_LENGTH = 48;

/** Words that make a key read as cut off when they end it ("...fed-by"). */
const TRAILING_FILLER = new Set('a an and as at by for from in into is of on or the to via vs with without'.split(' '));

/** Sentence and clause breaks: ". ", ", ", ": ", "; ", " - ", " — ", new lines. */
const CLAUSE_BREAK = /[.,:;!?](?=\s)|\s[-–—]\s|\n/g;

/**
 * The first clause of the text that has at least two words, so a long
 * sentence yields its lead phrase rather than whatever six words come first.
 */
function leadClause(text: string): string {
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    const head = text.slice(0, match.index);
    if (toWords(head).length >= 2) return head;
  }
  return text;
}

function toWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Up to six words of the text's lead clause, at most 48 characters, never
 * ending on a filler word, so the key reads as a phrase rather than a cut.
 */
export function slugify(text: string): string {
  const words: string[] = [];
  let length = 0;
  for (const word of toWords(leadClause(text)).slice(0, MAX_SLUG_WORDS)) {
    length += word.length + (words.length ? 1 : 0);
    if (length > MAX_SLUG_LENGTH) break;
    words.push(word);
  }
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1]!)) words.pop();
  return words.join('-') || 'untitled';
}

export function suggestKey(type: string, title: string): string {
  return `${type}/${slugify(title)}`;
}

/** `base`, or `base-2`, `base-3`, ... whichever is free first. */
export async function uniqueKey(base: string, isTaken: (key: string) => Promise<boolean>): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}

/** Keys are stored as given apart from trimming; they are identities, not vocabulary. */
export function cleanKey(key: string): string {
  return key.trim();
}

export type Ref = { kind: 'key'; namespace: string; key: string } | { kind: 'id'; id: string };

/**
 * Parses what a caller typed: `ns:key`, a bare key (resolved against the
 * write namespace), or a ULID id.
 */
export function parseRef(ctx: Context, input: string): Ref {
  const value = input.trim();
  if (isUlid(value)) return { kind: 'id', id: value };
  // The namespace ends at the last colon before the first slash, so `user:alice:note/x` works.
  const slash = value.indexOf('/');
  const colon = (slash === -1 ? value : value.slice(0, slash)).lastIndexOf(':');
  if (colon > 0) {
    return { kind: 'key', namespace: value.slice(0, colon), key: value.slice(colon + 1) };
  }
  return { kind: 'key', namespace: ctx.writeNamespace, key: value };
}

/**
 * Keys in the write namespace are shown bare, since a bare key resolves there
 * (parseRef); keys in any other namespace are qualified, e.g. `mcpdia:concept/x`.
 */
export function displayKey(ctx: Context, namespace: string, key: string): string {
  return namespace === ctx.writeNamespace ? key : `${namespace}:${key}`;
}
