import type { Context } from '../context.js';
import type { GraphStore, NodeRecord } from '../store/GraphStore.js';
import { parseRef } from './keys.js';
import { findNode } from './nodes.js';
import { search } from './search.js';
import { getSetting, type OrientPreset } from './settings.js';

/** What `orient` shows. The tool layer turns it into text. Stays a few hundred tokens (ADR 0004). */
export interface OrientOutput {
  intro: string;
  houseRules: string[];
  /** Absent when the preset hides counts. */
  stats?: { nodes: number; nodeTypes: number; edgeTypes: number; topTypes: string[]; topEdgeTypes: string[] };
  empty: boolean;
  pinned: NodeRecord[];
  focus?: { words: string; nodes: NodeRecord[] };
  more: string;
}

export const DEFAULT_INTRO = [
  'MCPdia: a knowledge graph of linked notes. Loop: search → read stubs → get the few that matter → write back (upsert, annotate, link) → feedback on what helped.',
  "Notes and observations go in linked notes (annotate); edit a node's body only to correct shared facts.",
].join('\n');

const FOCUS_LIMIT = 5;

interface PresetShape {
  stats: boolean;
  topTypes: number;
  edgeTypes: boolean;
  focus: boolean;
}

const PRESETS: Record<OrientPreset, PresetShape> = {
  minimal: { stats: false, topTypes: 0, edgeTypes: false, focus: false },
  standard: { stats: true, topTypes: 5, edgeTypes: false, focus: true },
  verbose: { stats: true, topTypes: 10, edgeTypes: true, focus: true },
};

export async function orient(ctx: Context, store: GraphStore, input: { focus?: string }): Promise<OrientOutput> {
  const settings = await getSetting(store, ctx, 'orient');
  const shape = PRESETS[settings.preset] ?? PRESETS.standard;
  const topTypes = settings.topTypes ?? shape.topTypes;
  const focusOn = settings.focus ?? shape.focus;

  const stats = await store.stats(ctx.namespaces);
  const out: OrientOutput = {
    intro: settings.intro ?? DEFAULT_INTRO,
    houseRules: await getSetting(store, ctx, 'house_rules'),
    empty: stats.nodes === 0,
    pinned: [],
    more: 'More: list_types (vocabulary), recent (latest changes), search.',
  };
  if (out.empty) return out;

  if (shape.stats) {
    out.stats = {
      nodes: stats.nodes,
      nodeTypes: stats.nodeTypes.length,
      edgeTypes: stats.edgeTypes.length,
      topTypes: stats.nodeTypes.slice(0, topTypes).map((t) => t.name),
      topEdgeTypes: shape.edgeTypes ? stats.edgeTypes.slice(0, topTypes).map((t) => t.name) : [],
    };
  }

  for (const key of await getSetting(store, ctx, 'pinned')) {
    const node = await findNode(ctx, store, parseRef(ctx, key));
    if (node?.status === 'active') out.pinned.push(node);
  }

  if (focusOn && input.focus?.trim()) {
    const result = await search(ctx, store, { query: input.focus, level: 'title', limit: FOCUS_LIMIT }).catch(
      () => null,
    );
    if (result) out.focus = { words: input.focus.trim(), nodes: result.hits.map((h) => h.node) };
  }
  return out;
}
