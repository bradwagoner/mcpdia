import { createHash } from 'node:crypto';
import type { EdgeRecord, GraphStore, NewEdge, NodeFields, NodeRecord, NodeStatus } from '../store/GraphStore.js';
import { UserError } from './errors.js';
import { EXPORT_FORMAT_VERSION, type ExportHeader } from './export.js';

/**
 * Starter sets (ADR 0026): an export loaded into a namespace of its own. Each
 * reload is a three-way check per key: base (what was last applied or
 * acknowledged), yours (the node now) and incoming (the node in the source).
 * Nodes you haven't touched follow the source; nodes you edited stay yours,
 * and when the source changed them too, the load writes a conflict node to
 * review rather than choosing for you (ADR 0008: fix by detection and cleanup).
 */

/** Where the last load is remembered, per starter namespace. Not a layered setting. */
const LOADED_SCOPE = 'starter';
const LOADED_KEY = 'starter.loaded';

export const CONFLICT_TYPE = 'conflict';
export const CONFLICTS_WITH = 'conflicts_with';

export interface StarterLoaded {
  hash: string;
  source: string;
  loadedAt: string;
  /** Content hash per key of the version last applied or acknowledged: the base. */
  nodes?: Record<string, string>;
  /** Edges this set wrote, so a reload only removes its own. */
  edges?: string[];
}

export interface ConflictEntry {
  /** Key of the conflict node, in the starter namespace. */
  key: string;
  /** Key of your node it is about. */
  nodeKey: string;
  state: 'new' | 'updated' | 'reopened' | 'open';
}

export interface LoadResult {
  namespace: string;
  /** The text matched the last load, so nothing was written. */
  unchanged: boolean;
  nodes: number;
  created: number;
  updated: number;
  deleted: number;
  /** Nodes you edited whose source version hasn't changed since. */
  kept: number;
  edgesAdded: number;
  edgesRemoved: number;
  /** Every open conflict in the set, new ones first. */
  conflicts: ConflictEntry[];
}

interface Parsed {
  header: ExportHeader;
  nodes: NodeRecord[];
  edges: EdgeRecord[];
}

/** Reads `mcpdia-jsonl` text, checking the header before anything is written. */
export function parseExport(text: string): Parsed {
  const lines = withoutBom(text)
    .split('\n')
    .filter((l) => l.trim());
  const rows = lines.map((line, i) => {
    try {
      return JSON.parse(line) as { kind?: string };
    } catch {
      throw new UserError(`Line ${i + 1} is not JSON.`, 'Starter sets are files written by mcpdia export.');
    }
  });
  const header = rows[0] as Partial<ExportHeader> | undefined;
  if (header?.kind !== 'header' || header.format !== 'mcpdia-jsonl') {
    throw new UserError('Not an mcpdia export: the first line is not an mcpdia-jsonl header.');
  }
  if (typeof header.version !== 'number' || header.version > EXPORT_FORMAT_VERSION) {
    throw new UserError(
      `Export format version ${String(header.version)} is newer than this MCPdia reads (${EXPORT_FORMAT_VERSION}).`,
      'Update MCPdia.',
    );
  }
  const nodes = rows.filter((r) => r.kind === 'node') as unknown as NodeRecord[];
  const edges = rows.filter((r) => r.kind === 'edge') as unknown as EdgeRecord[];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.key)) {
      throw new UserError(
        `The export has ${n.key} twice, so it spans several namespaces.`,
        'Export one namespace for a starter set: mcpdia export --namespace <ns>.',
      );
    }
    seen.add(n.key);
  }
  return { header: header as ExportHeader, nodes, edges };
}

export async function lastLoaded(store: GraphStore, namespace: string): Promise<StarterLoaded | undefined> {
  const rows = await store.getSettings([namespace], LOADED_KEY);
  return rows.find((r) => r.scope === LOADED_SCOPE)?.value as StarterLoaded | undefined;
}

/** The conflict node for a key: one per node, whatever the version. */
export function conflictKey(nodeKey: string): string {
  return `${CONFLICT_TYPE}/${nodeKey}`;
}

/** Editors on Windows often start a UTF-8 file with a byte-order mark. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Brings `namespace` up to date with the export in `text`. Ends that were in
 * the export's own namespaces move to `namespace`; links to anywhere else keep
 * their namespace and resolve whenever that node exists (ADR 0007).
 */
export async function loadStarter(
  store: GraphStore,
  namespace: string,
  source: string,
  text: string,
): Promise<LoadResult> {
  const result: LoadResult = {
    namespace,
    unchanged: false,
    nodes: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    kept: 0,
    edgesAdded: 0,
    edgesRemoved: 0,
    conflicts: [],
  };
  const before = await lastLoaded(store, namespace);
  const { header, nodes, edges } = parseExport(text);
  const hash = contentHash(withoutBom(text));
  result.nodes = nodes.length;
  if (before?.hash === hash) {
    return { ...result, unchanged: true, conflicts: await openConflicts(store, namespace) };
  }
  const existing = new Map((await store.listNodes([namespace])).map((n) => [n.key, n]));
  // A first load that stopped halfway leaves only the set's own rows, which are fine to finish.
  if (!before && [...existing.values()].some((n) => n.source !== `starter:${namespace}`)) {
    throw new UserError(
      `Namespace ${namespace} already has nodes that didn't come from a starter set.`,
      'Load the set under another name.',
    );
  }

  const fromSet = new Set(header.namespaces);
  const moved = (ns: string) => (fromSet.has(ns) ? namespace : ns);
  const by = `starter:${namespace}`;
  const base: Record<string, string> = { ...before?.nodes };
  const fresh: ConflictEntry[] = [];
  /** The version this set last applied for a key, or undefined for nodes it never loaded. */
  const lastFor = (node: NodeRecord) =>
    base[node.key] ?? (node.source === by && node.updatedBy === by ? versionHash(node) : undefined);

  const idByOldId = new Map<string, string>();
  /** Nodes whose status should follow the source, set once every node exists. */
  const follow: [NodeRecord, NodeRecord][] = [];

  for (const incoming of nodes) {
    const theirs = versionHash(incoming);
    let node = existing.get(incoming.key);
    if (!node) {
      node = await store.createNode({
        ...nodeFields(incoming),
        namespace,
        key: incoming.key,
        source: by,
        author: incoming.author,
      });
      result.created++;
      follow.push([node, incoming]);
      base[incoming.key] = theirs;
    } else {
      const yours = versionHash(node);
      const last = lastFor(node);
      if (yours === theirs) {
        base[incoming.key] = theirs;
      } else if (last === theirs) {
        result.kept++;
      } else if (last === yours) {
        node = await store.updateNode(node.id, nodeFields(incoming), by);
        result.updated++;
        follow.push([node, incoming]);
        base[incoming.key] = theirs;
      } else {
        const entry = await writeConflict(store, namespace, by, node, incoming, theirs);
        // A conflict you already resolved for this version counts as acknowledged.
        if (entry) fresh.push(entry);
        else base[incoming.key] = theirs;
      }
    }
    idByOldId.set(incoming.id, node.id);
  }
  for (const [node, incoming] of follow) {
    const supersededBy = incoming.supersededBy ? idByOldId.get(incoming.supersededBy) : undefined;
    if (node.status !== incoming.status || (supersededBy && node.supersededBy !== supersededBy)) {
      await store.setStatus(node.id, incoming.status, by, supersededBy);
    }
  }

  // Gone from the source: follow it if you never touched the node, otherwise ask.
  // Nodes you added to this namespace yourself were never in the set, so they're left alone.
  const inSource = new Set(nodes.map((n) => n.key));
  for (const node of existing.values()) {
    if (inSource.has(node.key) || node.type === CONFLICT_TYPE || node.status === 'deleted') continue;
    if (!(node.key in base) && node.source !== by) continue;
    const last = lastFor(node);
    if (last === versionHash(node)) {
      await store.setStatus(node.id, 'deleted', by);
      result.deleted++;
      delete base[node.key];
    } else {
      // Tied to the version removed, so a node that comes back and goes again asks again.
      const entry = await writeConflict(store, namespace, by, node, null, `${REMOVED}:${last ?? ''}`);
      if (entry) fresh.push(entry);
    }
  }

  // Links: add the set's, and remove only ones the set wrote before.
  const wantedEdges = new Set<string>();
  for (const e of edges) {
    const edge: NewEdge = {
      fromNamespace: moved(e.fromNamespace),
      fromKey: e.fromKey,
      toNamespace: moved(e.toNamespace),
      toKey: e.toKey,
      type: e.type,
      note: e.note,
      source: by,
      author: e.author,
    };
    wantedEdges.add(edgeKey(edge));
    if ((await store.upsertEdge(edge)).created) result.edgesAdded++;
  }
  const ours = new Set(before?.edges ?? []);
  for (const e of await store.listEdges([namespace])) {
    const key = edgeKey(e);
    if (ours.has(key) && !wantedEdges.has(key)) {
      await store.deleteEdge(e.id);
      result.edgesRemoved++;
    }
  }

  const loaded: StarterLoaded = {
    hash,
    source,
    loadedAt: new Date().toISOString(),
    nodes: base,
    edges: [...wantedEdges],
  };
  await store.putSetting(namespace, LOADED_SCOPE, LOADED_KEY, loaded);

  const freshKeys = new Set(fresh.map((c) => c.key));
  const stillOpen = (await openConflicts(store, namespace)).filter((c) => !freshKeys.has(c.key));
  return { ...result, conflicts: [...fresh, ...stillOpen] };
}

/** Stands in for the incoming version when the source dropped the node. */
const REMOVED = 'removed';

/**
 * Writes or refreshes the one conflict node for `node`. Returns undefined when
 * a conflict for this exact incoming version was already resolved (deleted),
 * so a resolved conflict stays resolved until the source changes again.
 */
async function writeConflict(
  store: GraphStore,
  namespace: string,
  by: string,
  node: NodeRecord,
  incoming: NodeRecord | null,
  incomingHash: string,
): Promise<ConflictEntry | undefined> {
  const key = conflictKey(node.key);
  const fields: NodeFields = {
    type: CONFLICT_TYPE,
    title: `Conflict: ${incoming?.title ?? node.title}`,
    summary: incoming
      ? `The starter set changed ${node.key} after you edited it. Compare, keep what's right, then delete this node.`
      : `The starter set removed ${node.key}, which you edited. Keep it or delete it, then delete this node.`,
    body: incoming ? conflictBody(incoming) : 'Removed upstream.',
    properties: { starter: namespace, node_key: node.key, incoming_hash: incomingHash },
    aliases: [],
    tags: [CONFLICT_TYPE],
  };
  const current = await store.getNode(namespace, key);
  let state: ConflictEntry['state'];
  if (!current) {
    await store.createNode({ ...fields, namespace, key, source: by, author: by });
    state = 'new';
  } else if (current.properties.incoming_hash === incomingHash) {
    if (current.status === 'deleted') return undefined;
    state = 'open';
  } else {
    await store.updateNode(current.id, fields, by);
    if (current.status === 'deleted') await store.setStatus(current.id, 'active', by);
    state = current.status === 'deleted' ? 'reopened' : 'updated';
  }
  await store.upsertEdge({
    fromNamespace: namespace,
    fromKey: key,
    toNamespace: node.namespace,
    toKey: node.key,
    type: CONFLICTS_WITH,
    note: null,
    source: by,
    author: by,
  });
  return { key, nodeKey: node.key, state };
}

/** The incoming version, laid out so a model can compare it with yours. */
function conflictBody(n: NodeRecord): string {
  return [
    `Incoming title: ${n.title}`,
    n.summary && `Incoming summary: ${n.summary}`,
    n.tags?.length && `Incoming tags: ${n.tags.join(', ')}`,
    n.status !== 'active' && `Incoming status: ${n.status}`,
    n.body && `Incoming body:\n${n.body}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function openConflicts(store: GraphStore, namespace: string): Promise<ConflictEntry[]> {
  return (await store.listNodes([namespace]))
    .filter((n) => n.type === CONFLICT_TYPE && n.status === 'active')
    .map((n) => ({ key: n.key, nodeKey: String(n.properties.node_key ?? ''), state: 'open' as const }));
}

function edgeKey(e: { fromNamespace: string; fromKey: string; toNamespace: string; toKey: string; type: string }) {
  return JSON.stringify([e.fromNamespace, e.fromKey, e.toNamespace, e.toKey, e.type]);
}

/** Hash of the export without its timestamp, so a fresh export of the same graph counts as unchanged. */
function contentHash(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim());
  const { exportedAt: _, ...header } = JSON.parse(lines[0]!) as ExportHeader;
  return createHash('sha256').update(JSON.stringify(header)).update(lines.slice(1).join('\n')).digest('hex');
}

/**
 * A node's content: fields and status, never ids or timestamps. The replacing
 * node is named by key presence only, since ids differ between graphs.
 */
function versionHash(n: NodeRecord): string {
  const status: NodeStatus = n.status;
  return createHash('sha256')
    .update(stable({ ...nodeFields(n), status, superseded: Boolean(n.supersededBy) }))
    .digest('hex')
    .slice(0, 16);
}

function nodeFields(n: NodeRecord): NodeFields {
  return {
    type: n.type,
    title: n.title,
    summary: n.summary ?? null,
    body: n.body ?? null,
    properties: n.properties ?? {},
    aliases: [...(n.aliases ?? [])].sort(),
    tags: [...(n.tags ?? [])].sort(),
  };
}

/** JSON with object keys sorted, so key order doesn't count as a change. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
