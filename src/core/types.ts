import type { Context } from '../context.js';
import type { GraphStore, TypeCount } from '../store/GraphStore.js';
import { squashType, STARTER_EDGE_TYPES, STARTER_NODE_TYPES } from './vocabulary.js';

export interface TypesOutput {
  nodeTypes: TypeCount[];
  edgeTypes: TypeCount[];
  /** Starter vocabulary not used yet: suggestions, not rules (ADR 0002). */
  unusedNodeStarters: string[];
  unusedEdgeStarters: string[];
  /** Types in use that differ only by a plural or a separator, like task and tasks. */
  lookalikes: [string, string][];
}

/** The vocabulary in use, with counts, so writers reuse types instead of inventing near-duplicates. */
export async function listTypes(ctx: Context, store: GraphStore): Promise<TypesOutput> {
  const stats = await store.stats(ctx.namespaces);
  const usedNode = new Set(stats.nodeTypes.map((t) => t.name));
  const usedEdge = new Set(stats.edgeTypes.map((t) => t.name));
  return {
    nodeTypes: stats.nodeTypes,
    edgeTypes: stats.edgeTypes,
    unusedNodeStarters: STARTER_NODE_TYPES.filter((t) => !usedNode.has(t)),
    unusedEdgeStarters: STARTER_EDGE_TYPES.filter((t) => !usedEdge.has(t)),
    lookalikes: [...pairs([...usedNode]), ...pairs([...usedEdge])],
  };
}

function pairs(names: string[]): [string, string][] {
  const out: [string, string][] = [];
  names.forEach((a, i) => {
    for (const b of names.slice(i + 1)) if (squashType(a) === squashType(b)) out.push([a, b]);
  });
  return out;
}
