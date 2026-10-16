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
