import { ulid } from '../../ulid.js';
import {
  VersionConflictError,
  type EdgeRecord,
  type FeedbackVerdict,
  type GraphStats,
  type GraphStore,
  type Neighbor,
  type NewEdge,
  type NewNode,
  type NodePatch,
  type NodeRecord,
  type NodeStatus,
  type RecentEntry,
  type RecentQuery,
  type SearchQuery,
  type SearchResult,
  type SettingRow,
} from '../GraphStore.js';
import type { PgDatabase, Sql } from './db.js';
import { migrate } from './migrate.js';

/** Every node column except the internal seq and search ones. */
const NODE_COLUMNS = `id, namespace, key, type, title, summary, body, properties, aliases, tags, status,
  superseded_by, version, source, author, updated_by, created_at, updated_at, last_verified_at,
  useful_count, not_useful_count, wrong_count, last_useful_at, last_wrong_at`;

/** The Postgres twin of SqliteStore (ADR 0025). Same contract, same shared test suite. */
export class PostgresStore implements GraphStore {
  private constructor(private readonly db: PgDatabase) {}

  /** Brings the schema up to date, then returns the store. */
  static async open(db: PgDatabase): Promise<PostgresStore> {
    await migrate(db);
    return new PostgresStore(db);
  }

  async getNode(namespace: string, key: string): Promise<NodeRecord | null> {
    const rows = await this.db.query<NodeRow>(`SELECT ${NODE_COLUMNS} FROM nodes WHERE namespace = $1 AND key = $2`, [
      namespace,
      key,
    ]);
    return rows[0] ? toNode(rows[0]) : null;
  }

  async getNodeById(id: string): Promise<NodeRecord | null> {
    return (await this.getNodesByIds([id])).get(id) ?? null;
  }

  async getNodesByIds(ids: string[]): Promise<Map<string, NodeRecord>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.query<NodeRow>(`SELECT ${NODE_COLUMNS} FROM nodes WHERE id = ANY($1)`, [ids]);
    return new Map(rows.map((r) => [r.id, toNode(r)]));
  }

  async createNode(node: NewNode): Promise<NodeRecord> {
    const id = ulid();
    const now = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO nodes (id, namespace, key, type, title, summary, body, properties, aliases, tags,
                            source, author, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $13)`,
        [
          id,
          node.namespace,
          node.key,
          node.type,
          node.title,
          node.summary,
          node.body,
          JSON.stringify(node.properties),
          sortedSet(node.aliases),
          sortedSet(node.tags),
          node.source,
          node.author,
          now,
        ],
      );
      const created = await recordVersion(tx, id, 'create', node.author, now);
      // Late-bound edges (ADR 0007): anything already pointing at this key now resolves.
      await resolveWaitingEdges(tx, id, node.namespace, node.key);
      return created;
    });
  }

  async updateNode(id: string, patch: NodePatch, changedBy: string, expectedVersion?: number): Promise<NodeRecord> {
    const now = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      // FOR UPDATE holds the row, so two writers can't both pass the version check.
      const [row] = await tx.query<NodeRow>(`SELECT ${NODE_COLUMNS} FROM nodes WHERE id = $1 FOR UPDATE`, [id]);
      const current = toNode(row!);
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new VersionConflictError(current);
      }
      await tx.query(
        `UPDATE nodes SET type = $1, title = $2, summary = $3, body = $4, properties = $5, aliases = $6, tags = $7,
                version = version + 1, updated_by = $8, updated_at = $9, last_wrong_at = NULL
          WHERE id = $10`,
        [
          patch.type ?? current.type,
          patch.title ?? current.title,
          patch.summary !== undefined ? patch.summary : current.summary,
          patch.body !== undefined ? patch.body : current.body,
          JSON.stringify(patch.properties ?? current.properties),
          patch.aliases !== undefined ? sortedSet(patch.aliases) : current.aliases,
          patch.tags !== undefined ? sortedSet(patch.tags) : current.tags,
          changedBy,
          now,
          id,
        ],
      );
      return recordVersion(tx, id, 'update', changedBy, now);
    });
  }

  async setStatus(id: string, status: NodeStatus, changedBy: string, supersededBy?: string): Promise<NodeRecord> {
    const now = new Date().toISOString();
    const changeType = status === 'active' ? 'restore' : status === 'superseded' ? 'supersede' : 'delete';
    return this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE nodes SET status = $1, superseded_by = $2, version = version + 1, updated_by = $3, updated_at = $4
          WHERE id = $5`,
        [status, status === 'superseded' ? (supersededBy ?? null) : null, changedBy, now, id],
      );
      const node = await recordVersion(tx, id, changeType, changedBy, now);
      // Links made while it was deleted were stored unresolved (resolveId skips deleted nodes).
      if (status === 'active') await resolveWaitingEdges(tx, id, node.namespace, node.key);
      return node;
    });
  }

  async markVerified(ids: string[], at: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.query(`UPDATE nodes SET last_verified_at = $1, last_wrong_at = NULL WHERE id = ANY($2)`, [at, ids]);
  }

  async recordFeedback(ids: string[], verdict: FeedbackVerdict, at: string): Promise<void> {
    if (ids.length === 0) return;
    const set = {
      useful: 'useful_count = useful_count + 1, last_useful_at = $2',
      not_useful: 'not_useful_count = not_useful_count + 1',
      outdated_or_wrong: 'wrong_count = wrong_count + 1, last_wrong_at = $2',
    }[verdict];
    const params = verdict === 'not_useful' ? [ids] : [ids, at];
    await this.db.query(`UPDATE nodes SET ${set} WHERE id = ANY($1)`, params);
  }

  async recent(q: RecentQuery): Promise<RecentEntry[]> {
    if (q.namespaces.length === 0) return [];
    const p = new Params();
    // The latest of the last write and the last useful mark.
    const at = `CASE WHEN last_useful_at > updated_at THEN last_useful_at ELSE updated_at END`;
    const where = [`status = 'active'`, `namespace = ANY(${p.add(q.namespaces)})`];
    if (q.since) where.push(`${at} >= ${p.add(q.since)}`);
    if (q.updatedBy) where.push(`updated_by = ${p.add(q.updatedBy)}`);
    const rows = await this.db.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM nodes WHERE ${where.join(' AND ')}
        ORDER BY ${at} DESC, id DESC LIMIT ${p.add(q.limit)}`,
      p.values,
    );
    return rows.map(toNode).map((node) => {
      if (node.lastUsefulAt && node.lastUsefulAt > node.updatedAt)
        return { node, kind: 'useful', at: node.lastUsefulAt };
      return { node, kind: node.version === 1 ? 'created' : 'updated', at: node.updatedAt };
    });
  }

  async repointEdges(oldId: string, replacement: NodeRecord): Promise<number> {
    const now = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<EdgeRow>(
        `SELECT * FROM edges WHERE status = 'active' AND (from_id = $1 OR to_id = $1) ORDER BY seq FOR UPDATE`,
        [oldId],
      );
      const here = { ns: replacement.namespace, key: replacement.key, id: replacement.id };
      let moved = 0;
      for (const e of rows) {
        const from = e.from_id === oldId ? here : { ns: e.from_namespace, key: e.from_key, id: e.from_id };
        const to = e.to_id === oldId ? here : { ns: e.to_namespace, key: e.to_key, id: e.to_id };
        const selfLoop = from.ns === to.ns && from.key === to.key;
        const duplicate =
          !selfLoop &&
          (
            await tx.query(
              `SELECT 1 FROM edges WHERE status = 'active' AND id != $1 AND from_namespace = $2 AND from_key = $3
                 AND to_namespace = $4 AND to_key = $5 AND type = $6`,
              [e.id, from.ns, from.key, to.ns, to.key, e.type],
            )
          ).length > 0;
        if (selfLoop || duplicate) {
          await tx.query(`UPDATE edges SET status = 'deleted', version = version + 1, updated_at = $1 WHERE id = $2`, [
            now,
            e.id,
          ]);
        } else {
          await tx.query(
            `UPDATE edges SET from_namespace = $1, from_key = $2, from_id = $3, to_namespace = $4, to_key = $5,
                    to_id = $6, version = version + 1, updated_at = $7
              WHERE id = $8`,
            [from.ns, from.key, from.id, to.ns, to.key, to.id, now, e.id],
          );
          moved++;
        }
      }
      return moved;
    });
  }

  async search(q: SearchQuery): Promise<SearchResult> {
    if (q.terms.length === 0 || q.namespaces.length === 0) return { nodes: [], total: 0 };
    const p = new Params();
    // Each term is passed as a parameter, so user text is never read as tsquery syntax.
    // A prefix term is quoted inside the tsquery text for the same reason.
    const query = q.terms
      .map((t) =>
        q.prefix
          ? `to_tsquery('mcpdia', ${p.add(`'${t.replaceAll('\\', '\\\\').replaceAll("'", "''")}':*`)})`
          : `plainto_tsquery('mcpdia', ${p.add(t)})`,
      )
      .join(q.match === 'all' ? ' && ' : ' || ');
    const where = [
      `search @@ q.query`,
      `status = ANY(${p.add(q.statuses ?? ['active'])})`,
      `namespace = ANY(${p.add(q.namespaces)})`,
    ];
    if (q.type) where.push(`type = ${p.add(q.type)}`);
    if (q.ids) where.push(`id = ANY(${p.add(q.ids)})`);
    if (q.tag) where.push(`${p.add(q.tag)} = ANY(tags)`);
    const from = `FROM nodes, (SELECT ${query} AS query) q WHERE ${where.join(' AND ')}`;

    // Weights for D, C, B, A: body 1, tags 3, summary and aliases 5, title 10, as in SqliteStore.
    // Nodes marked useful get at most a 10% boost (ADR 0005: keep it small).
    const rows = await this.db.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} ${from}
        ORDER BY ts_rank('{0.1, 0.3, 0.5, 1.0}', search, q.query) * (1.0 + 0.1 * least(useful_count, 5) / 5.0) DESC,
                 seq
        LIMIT ${p.add(q.limit)}`,
      p.values,
    );
    const [count] = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total ${from}`,
      p.values.slice(0, -1),
    );
    return { nodes: rows.map(toNode), total: count!.total };
  }

  async upsertEdge(edge: NewEdge): Promise<{ edge: EdgeRecord; created: boolean }> {
    const now = new Date().toISOString();
    const [existing] = await this.db.query<EdgeRow>(
      `SELECT * FROM edges WHERE status = 'active' AND from_namespace = $1 AND from_key = $2
         AND to_namespace = $3 AND to_key = $4 AND type = $5`,
      [edge.fromNamespace, edge.fromKey, edge.toNamespace, edge.toKey, edge.type],
    );

    if (existing) {
      if (edge.note !== null && edge.note !== existing.note) {
        const [updated] = await this.db.query<EdgeRow>(
          'UPDATE edges SET note = $1, version = version + 1, updated_at = $2 WHERE id = $3 RETURNING *',
          [edge.note, now, existing.id],
        );
        return { edge: toEdge(updated!), created: false };
      }
      return { edge: toEdge(existing), created: false };
    }

    const [created] = await this.db.query<EdgeRow>(
      `INSERT INTO edges (id, from_namespace, from_key, to_namespace, to_key, from_id, to_id,
                          type, note, source, author, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, (${RESOLVE_ID('$2', '$3')}), (${RESOLVE_ID('$4', '$5')}),
               $6, $7, $8, $9, $10, $10)
       RETURNING *`,
      [
        ulid(),
        edge.fromNamespace,
        edge.fromKey,
        edge.toNamespace,
        edge.toKey,
        edge.type,
        edge.note,
        edge.source,
        edge.author,
        now,
      ],
    );
    return { edge: toEdge(created!), created: true };
  }

  async deleteEdge(id: string): Promise<void> {
    await this.db.query(
      `UPDATE edges SET status = 'deleted', version = version + 1, updated_at = $1 WHERE id = $2 AND status = 'active'`,
      [new Date().toISOString(), id],
    );
  }

  async neighbors(nodeId: string): Promise<Neighbor[]> {
    const rows = await this.db.query<EdgeRow>(
      `SELECT * FROM edges WHERE status = 'active' AND (from_id = $1 OR to_id = $1) ORDER BY type, created_at, seq`,
      [nodeId],
    );
    const edges = rows.map(toEdge);
    const otherIds = edges
      .map((e) => (e.fromId === nodeId ? e.toId : e.fromId))
      .filter((id): id is string => id !== null);
    const others = await this.getNodesByIds([...new Set(otherIds)]);

    return edges.map((edge) => {
      const out = edge.fromId === nodeId;
      const otherId = out ? edge.toId : edge.fromId;
      const other = otherId ? others.get(otherId) : undefined;
      return {
        direction: out ? 'out' : 'in',
        edge,
        otherNamespace: out ? edge.toNamespace : edge.fromNamespace,
        otherKey: out ? edge.toKey : edge.fromKey,
        other: other && other.status !== 'deleted' ? other : null,
      };
    });
  }

  async edgeCounts(nodeIds: string[]): Promise<Map<string, number>> {
    if (nodeIds.length === 0) return new Map();
    const rows = await this.db.query<{ id: string; count: number }>(
      `SELECT n.id,
              (SELECT count(*)::int FROM edges e
                WHERE e.status = 'active' AND (e.from_id = n.id OR e.to_id = n.id)) AS count
         FROM nodes n WHERE n.id = ANY($1)`,
      [nodeIds],
    );
    return new Map(rows.map((r) => [r.id, r.count]));
  }

  async linksInto(nodeIds: string[], type: string): Promise<Map<string, { namespace: string; key: string }[]>> {
    if (nodeIds.length === 0) return new Map();
    const rows = await this.db.query<{ id: string; namespace: string; key: string }>(
      `SELECT e.to_id AS id, e.from_namespace AS namespace, e.from_key AS key
         FROM edges e JOIN nodes f ON f.id = e.from_id
        WHERE e.status = 'active' AND f.status = 'active' AND e.type = $1 AND e.to_id = ANY($2)
        ORDER BY e.created_at, e.seq`,
      [type, nodeIds],
    );
    const byId = new Map<string, { namespace: string; key: string }[]>();
    for (const { id, namespace, key } of rows) byId.set(id, [...(byId.get(id) ?? []), { namespace, key }]);
    return byId;
  }

  // Rows made in the same millisecond tie on created_at, and ULIDs are random within a
  // millisecond, so seq (insertion order) breaks the tie.
  async listNodes(namespaces: string[]): Promise<NodeRecord[]> {
    if (namespaces.length === 0) return [];
    const rows = await this.db.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM nodes WHERE namespace = ANY($1) ORDER BY created_at, seq`,
      [namespaces],
    );
    return rows.map(toNode);
  }

  async listEdges(namespaces: string[]): Promise<EdgeRecord[]> {
    if (namespaces.length === 0) return [];
    const rows = await this.db.query<EdgeRow>(
      `SELECT * FROM edges WHERE status = 'active' AND from_namespace = ANY($1) ORDER BY created_at, seq`,
      [namespaces],
    );
    return rows.map(toEdge);
  }

  async stats(namespaces: string[]): Promise<GraphStats> {
    if (namespaces.length === 0) return { nodes: 0, nodeTypes: [], edgeTypes: [] };
    const nodeTypes = await this.db.query<{ name: string; count: number }>(
      `SELECT type AS name, count(*)::int AS count FROM nodes
        WHERE status = 'active' AND namespace = ANY($1)
        GROUP BY type ORDER BY count DESC, type`,
      [namespaces],
    );
    const edgeTypes = await this.db.query<{ name: string; count: number }>(
      `SELECT type AS name, count(*)::int AS count FROM edges
        WHERE status = 'active' AND from_namespace = ANY($1)
        GROUP BY type ORDER BY count DESC, type`,
      [namespaces],
    );
    return { nodes: nodeTypes.reduce((sum, t) => sum + t.count, 0), nodeTypes, edgeTypes };
  }

  async getSettings(namespaces: string[], key: string): Promise<SettingRow[]> {
    if (namespaces.length === 0) return [];
    return this.db.query<SettingRow>(
      `SELECT namespace, scope, value FROM settings WHERE key = $1 AND namespace = ANY($2)`,
      [key, namespaces],
    );
  }

  async putSetting(namespace: string, scope: string, key: string, value: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (namespace, scope, key, value, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (namespace, scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [namespace, scope, key, JSON.stringify(value), new Date().toISOString()],
    );
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

// --- helpers -----------------------------------------------------------

/** Collects query parameters and hands back their `$n` placeholders. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** The live node a reference points at; deleted nodes don't count. */
const RESOLVE_ID = (ns: string, key: string) =>
  `SELECT id FROM nodes WHERE namespace = ${ns} AND key = ${key} AND status != 'deleted'`;

/** Snapshot of the node as it stands now, stored under its current version. Returns the node. */
async function recordVersion(tx: Sql, id: string, changeType: string, changedBy: string, at: string) {
  const [row] = await tx.query<NodeRow>(`SELECT ${NODE_COLUMNS} FROM nodes WHERE id = $1`, [id]);
  const node = toNode(row!);
  await tx.query(
    `INSERT INTO node_versions (node_id, version, snapshot, body_len, change_type, changed_by, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, node.version, JSON.stringify(node), node.body?.length ?? 0, changeType, changedBy, at],
  );
  return node;
}

async function resolveWaitingEdges(tx: Sql, id: string, namespace: string, key: string): Promise<void> {
  await tx.query('UPDATE edges SET to_id = $1 WHERE to_namespace = $2 AND to_key = $3 AND to_id IS NULL', [
    id,
    namespace,
    key,
  ]);
  await tx.query('UPDATE edges SET from_id = $1 WHERE from_namespace = $2 AND from_key = $3 AND from_id IS NULL', [
    id,
    namespace,
    key,
  ]);
}

/** Aliases and tags are stored sorted and without repeats, as SQLite returns them. */
function sortedSet(values: string[]): string[] {
  return [...new Set(values)].sort();
}

interface NodeRow {
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
  status: string;
  superseded_by: string | null;
  version: number;
  source: string;
  author: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  last_verified_at: string | null;
  useful_count: number;
  not_useful_count: number;
  wrong_count: number;
  last_useful_at: string | null;
  last_wrong_at: string | null;
}

interface EdgeRow {
  id: string;
  from_namespace: string;
  from_key: string;
  to_namespace: string;
  to_key: string;
  from_id: string | null;
  to_id: string | null;
  type: string;
  note: string | null;
  version: number;
  author: string;
  created_at: string;
  updated_at: string;
}

function toNode(r: NodeRow): NodeRecord {
  return {
    id: r.id,
    namespace: r.namespace,
    key: r.key,
    type: r.type,
    title: r.title,
    summary: r.summary,
    body: r.body,
    properties: r.properties,
    aliases: r.aliases,
    tags: r.tags,
    status: r.status as NodeStatus,
    supersededBy: r.superseded_by,
    version: r.version,
    source: r.source,
    author: r.author,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastVerifiedAt: r.last_verified_at,
    usefulCount: r.useful_count,
    notUsefulCount: r.not_useful_count,
    wrongCount: r.wrong_count,
    lastUsefulAt: r.last_useful_at,
    lastWrongAt: r.last_wrong_at,
  };
}

function toEdge(r: EdgeRow): EdgeRecord {
  return {
    id: r.id,
    fromNamespace: r.from_namespace,
    fromKey: r.from_key,
    toNamespace: r.to_namespace,
    toKey: r.to_key,
    fromId: r.from_id,
    toId: r.to_id,
    type: r.type,
    note: r.note,
    version: r.version,
    author: r.author,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
