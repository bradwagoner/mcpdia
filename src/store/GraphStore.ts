/**
 * The storage interface (ADR 0001, layer 3). The core talks only to this;
 * each adapter owns its SQL. Async throughout so network-backed stores fit.
 *
 * Inputs reaching the store are already normalized and validated by the core.
 */

export type NodeStatus = 'active' | 'superseded' | 'deleted';

export interface NodeRecord {
  id: string;
  namespace: string;
  key: string;
  type: string;
  title: string;
  summary: string | null;
  body: string | null;
  properties: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  status: NodeStatus;
  /** Id of the replacing node, when status is 'superseded'. */
  supersededBy: string | null;
  version: number;
  source: string;
  author: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
  usefulCount: number;
  notUsefulCount: number;
  wrongCount: number;
  lastUsefulAt: string | null;
  /** When it was marked outdated or wrong; cleared by the next edit or verify. */
  lastWrongAt: string | null;
}

/** The fields a caller can set on a node. */
export interface NodeFields {
  type: string;
  title: string;
  summary: string | null;
  body: string | null;
  properties: Record<string, unknown>;
  aliases: string[];
  tags: string[];
}

export interface NewNode extends NodeFields {
  namespace: string;
  key: string;
  source: string;
  author: string;
}

export type NodePatch = Partial<NodeFields>;

export interface EdgeRecord {
  id: string;
  fromNamespace: string;
  fromKey: string;
  toNamespace: string;
  toKey: string;
  fromId: string | null;
  toId: string | null;
  type: string;
  note: string | null;
  version: number;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewEdge {
  fromNamespace: string;
  fromKey: string;
  toNamespace: string;
  toKey: string;
  type: string;
  note: string | null;
  source: string;
  author: string;
}

/** An edge seen from one node, with the node at the other end when it is loaded. */
export interface Neighbor {
  direction: 'out' | 'in';
  edge: EdgeRecord;
  otherNamespace: string;
  otherKey: string;
  /** null when the other end is not loaded or has been deleted. */
  other: NodeRecord | null;
}

export interface SearchQuery {
  namespaces: string[];
  /** Plain words, already split into terms by the core. */
  terms: string[];
  /** 'all' requires every term; 'any' ranks partial matches too. */
  match: 'all' | 'any';
  /** Treat each term as a word prefix (used for "did you mean"). */
  prefix?: boolean;
  type?: string;
  tag?: string;
  /** Only these node ids, e.g. to check which words each hit matched. */
  ids?: string[];
  limit: number;
}

export interface SearchResult {
  nodes: NodeRecord[];
  total: number;
}

export interface TypeCount {
  name: string;
  count: number;
}

export interface GraphStats {
  nodes: number;
  nodeTypes: TypeCount[];
  edgeTypes: TypeCount[];
}

export interface SettingRow {
  namespace: string;
  scope: string;
  value: unknown;
}

export type FeedbackVerdict = 'useful' | 'not_useful' | 'outdated_or_wrong';

export interface RecentQuery {
  namespaces: string[];
  /** ISO timestamp; only activity at or after it. */
  since?: string;
  /** Only nodes last written by this caller. */
  updatedBy?: string;
  limit: number;
}

export interface RecentEntry {
  node: NodeRecord;
  /** What happened most recently: the node was created, edited, or marked useful. */
  kind: 'created' | 'updated' | 'useful';
  at: string;
}

export class VersionConflictError extends Error {
  constructor(public readonly current: NodeRecord) {
    super(`Version conflict on ${current.key}: now at v${current.version}`);
  }
}

export interface GraphStore {
  /** Any status. */
  getNode(namespace: string, key: string): Promise<NodeRecord | null>;
  getNodeById(id: string): Promise<NodeRecord | null>;
  getNodesByIds(ids: string[]): Promise<Map<string, NodeRecord>>;

  /** Creates the node, records version 1 and resolves edges waiting on its key. */
  createNode(node: NewNode): Promise<NodeRecord>;
  /**
   * Applies the patch and records the new version. When expectedVersion is given
   * and the node has moved on, throws VersionConflictError.
   */
  updateNode(id: string, patch: NodePatch, changedBy: string, expectedVersion?: number): Promise<NodeRecord>;
  /**
   * Moves a node to another status and records the version. `supersededBy`
   * is the replacing node's id and only applies to 'superseded'.
   */
  setStatus(id: string, status: NodeStatus, changedBy: string, supersededBy?: string): Promise<NodeRecord>;
  /** Sets last_verified_at without creating a new version, and clears last_wrong_at. */
  markVerified(ids: string[], at: string): Promise<void>;
  /** Bumps the verdict's counter; 'useful' also sets last_useful_at, 'outdated_or_wrong' last_wrong_at. */
  recordFeedback(ids: string[], verdict: FeedbackVerdict, at: string): Promise<void>;
  /** Active nodes by latest write or useful mark, newest first. */
  recent(query: RecentQuery): Promise<RecentEntry[]>;

  /** Active nodes only. */
  search(query: SearchQuery): Promise<SearchResult>;

  /** Insert, or update the note of the matching active edge. */
  upsertEdge(edge: NewEdge): Promise<{ edge: EdgeRecord; created: boolean }>;
  /**
   * Moves every active edge touching `oldId` onto `replacement`. An edge that
   * would duplicate an existing one, or link the two nodes to each other, is
   * soft-deleted instead. Returns how many edges moved.
   */
  repointEdges(oldId: string, replacement: NodeRecord): Promise<number>;
  /** Active edges touching the node, both directions. */
  neighbors(nodeId: string): Promise<Neighbor[]>;
  /** Active edge counts per node id. */
  edgeCounts(nodeIds: string[]): Promise<Map<string, number>>;

  /** Every node in the namespaces, any status, oldest first. Feeds export. */
  listNodes(namespaces: string[]): Promise<NodeRecord[]>;
  /** Active edges whose source is in the namespaces, oldest first. Feeds export. */
  listEdges(namespaces: string[]): Promise<EdgeRecord[]>;

  stats(namespaces: string[]): Promise<GraphStats>;
  /** Every stored value for the key across the given namespaces, any scope. */
  getSettings(namespaces: string[], key: string): Promise<SettingRow[]>;
  putSetting(namespace: string, scope: string, key: string, value: unknown): Promise<void>;

  close(): Promise<void>;
}
