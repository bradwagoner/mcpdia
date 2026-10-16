import type { Context } from '../context.js';
import type { EdgeRecord, GraphStore, NodeRecord, NodeStatus } from '../store/GraphStore.js';
import { UserError } from './errors.js';

/** Bump when the line format changes in a way import must know about. */
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportHeader {
  kind: 'header';
  format: 'mcpedia-jsonl';
  version: number;
  exportedAt: string;
  namespaces: string[];
  /** Node statuses included: `['active']` unless the export asked for every status. */
  statuses: NodeStatus[];
  nodes: number;
  edges: number;
}

export type ExportLine = ExportHeader | ({ kind: 'node' } & NodeRecord) | ({ kind: 'edge' } & EdgeRecord);

export interface ExportInput {
  /** Defaults to every namespace the caller can read. */
  namespaces?: string[];
  /** Include superseded and deleted nodes too. */
  allStatus?: boolean;
}

/**
 * Writes the graph as JSON Lines: one header, then the nodes, then the active
 * edges. Nodes come before edges so an importer can create them first.
 * Active nodes only unless `allStatus` is set. The format is in docs/schema.md.
 */
export async function exportJsonl(
  ctx: Context,
  store: GraphStore,
  input: ExportInput,
  write: (line: string) => void | Promise<void>,
): Promise<ExportHeader> {
  const namespaces = input.namespaces?.length ? input.namespaces : ctx.namespaces;
  const hidden = namespaces.filter((ns) => !ctx.namespaces.includes(ns));
  if (hidden.length) {
    throw new UserError(`Unknown namespace: ${hidden.join(', ')}.`, `readable: ${ctx.namespaces.join(', ')}`);
  }
  // Current state only: version history is not exported. For a full backup, copy the database file.
  const nodes = (await store.listNodes(namespaces)).filter((n) => input.allStatus || n.status === 'active');
  const edges = await store.listEdges(namespaces);

  const header: ExportHeader = {
    kind: 'header',
    format: 'mcpedia-jsonl',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    namespaces,
    statuses: input.allStatus ? ['active', 'superseded', 'deleted'] : ['active'],
    nodes: nodes.length,
    edges: edges.length,
  };
  await write(JSON.stringify(header));
  for (const node of nodes) await write(JSON.stringify({ kind: 'node', ...node }));
  for (const edge of edges) await write(JSON.stringify({ kind: 'edge', ...edge }));
  return header;
}
