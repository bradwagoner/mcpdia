/**
 * Type, tag and alias normalization (ADR 0002). Only trivially safe changes:
 * case, surrounding whitespace, and separators. Everything else is a hint.
 *
 * Node types and tags use hyphens (`how-to`); edge types use underscores
 * (`depends_on`), matching the starter vocabulary. See ADR 0012.
 */

export const STARTER_NODE_TYPES = ['concept', 'note', 'decision', 'how-to'];
export const STARTER_EDGE_TYPES = ['related_to', 'part_of', 'depends_on', 'supersedes', 'example_of', 'references'];

/** Edges that put a node under another one: its parents. */
export const PARENT_EDGE_TYPES = ['part_of', 'comments_on', 'candidate_for'];

export function normalizeNodeType(value: string): string {
  return normalizeWith(value, '-');
}

export function normalizeEdgeType(value: string): string {
  return normalizeWith(value, '_');
}

export function normalizeTag(value: string): string {
  return normalizeWith(value, '-');
}

/** Aliases are matched by people's words, so keep spaces: only case and spacing change. */
export function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeWith(value: string, separator: '-' | '_'): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '');
}

/** A type without separators or a trailing s, so how-to, howto and how_tos compare equal. */
export function squashType(name: string): string {
  return name.replace(/[-_]/g, '').replace(/s$/, '');
}

/**
 * When `type` is new, the closest existing (or starter) type that looks like
 * the same idea: equal after dropping separators and a plural "s", or within
 * edit distance 2. Returns null when the type is already in use or nothing is close.
 */
export function suggestType(type: string, existing: string[]): string | null {
  if (existing.includes(type)) return null;
  let best: { name: string; distance: number } | null = null;
  for (const name of existing) {
    const distance = squashType(name) === squashType(type) ? 0 : editDistance(name, type);
    if (distance <= 2 && (best === null || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? null;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}
