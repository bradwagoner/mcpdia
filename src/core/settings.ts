import type { Context } from '../context.js';
import type { GraphStore, SettingRow } from '../store/GraphStore.js';

/**
 * Settings are layered at read time: built-in, then pack, then team, then the
 * caller's own (schema.md). Object values merge key by key; anything else is
 * replaced by the most specific layer.
 */

export type OrientPreset = 'minimal' | 'standard' | 'verbose';

export interface OrientSettings {
  preset: OrientPreset;
  /** Replaces the built-in two-line intro when set. */
  intro?: string;
  /** Overrides the preset's number of top node types (0 hides the line). */
  topTypes?: number;
  /** Overrides whether `focus` words add "possibly relevant" results. */
  focus?: boolean;
}

export interface Settings {
  orient: OrientSettings;
  house_rules: string[];
  /** Keys of the "start here" nodes. */
  pinned: string[];
  /** Cap on keys per `get` call. A setting so it can be raised without code changes. */
  'get.max_keys': number;
}

export const BUILT_IN: Settings = {
  orient: { preset: 'standard' },
  house_rules: [],
  pinned: [],
  'get.max_keys': 10,
};

export async function getSetting<K extends keyof Settings>(
  store: GraphStore,
  ctx: Context,
  key: K,
): Promise<Settings[K]> {
  const rows = (await store.getSettings(ctx.namespaces, key))
    .map((row) => ({ row, rank: scopeRank(row, ctx) }))
    .filter((r) => r.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  let value: unknown = BUILT_IN[key];
  for (const { row } of rows) {
    value = isPlainObject(value) && isPlainObject(row.value) ? { ...value, ...row.value } : row.value;
  }
  return value as Settings[K];
}

/** 0 means "not for this caller". */
function scopeRank(row: SettingRow, ctx: Context): number {
  if (row.scope.startsWith('pack:')) return 1;
  if (row.scope === 'team') return 2;
  if (row.scope === `user:${ctx.caller}`) return 3;
  return 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
