import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
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
import { migrate } from './migrate.js';

/** The only place SQL lives (ADR 0001). */
export class SqliteStore implements GraphStore {
  private readonly db: Database.Database;

  /** `path` is a file path, or ':memory:' for tests. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    migrate(this.db);
  }

  async getNode(namespace: string, key: string): Promise<NodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM nodes WHERE namespace = ? AND key = ?').get(namespace, key);
    return row ? this.hydrate([row as NodeRow])[0]! : null;
  }

  async getNodeById(id: string): Promise<NodeRecord | null> {
    return (await this.getNodesByIds([id])).get(id) ?? null;
  }

  async getNodesByIds(ids: string[]): Promise<Map<string, NodeRecord>> {
    if (ids.length === 0) return new Map();
    const rows = this.db.prepare(`SELECT * FROM nodes WHERE id IN (${marks(ids)})`).all(...ids) as NodeRow[];
    return new Map(this.hydrate(rows).map((n) => [n.id, n]));
  }

  async createNode(node: NewNode): Promise<NodeRecord> {
    const id = ulid();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO nodes (id, namespace, key, type, title, summary, body, properties,
                              source, author, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          node.namespace,
          node.key,
          node.type,
          node.title,
          node.summary,
          node.body,
          JSON.stringify(node.properties),
          node.source,
          node.author,
          node.author,
          now,
          now,
        );
      this.writeAliasesAndTags(id, node.aliases, node.tags);
      this.recordVersion(id, 'create', node.author, now);
      // Late-bound edges (ADR 0007): anything already pointing at this key now resolves.
      this.resolveWaitingEdges(id, node.namespace, node.key);
    })();
    return (await this.getNodeById(id))!;
  }

  async updateNode(id: string, patch: NodePatch, changedBy: string, expectedVersion?: number): Promise<NodeRecord> {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const current = this.hydrate([this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow])[0]!;
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new VersionConflictError(current);
      }
      this.db
        .prepare(
          `UPDATE nodes SET type = ?, title = ?, summary = ?, body = ?, properties = ?,
                  version = version + 1, updated_by = ?, updated_at = ?, last_wrong_at = NULL
            WHERE id = ?`,
        )
        .run(
          patch.type ?? current.type,
          patch.title ?? current.title,
          patch.summary !== undefined ? patch.summary : current.summary,
          patch.body !== undefined ? patch.body : current.body,
          JSON.stringify(patch.properties ?? current.properties),
          changedBy,
          now,
          id,
        );
      if (patch.aliases !== undefined || patch.tags !== undefined) {
        if (patch.aliases !== undefined) this.db.prepare('DELETE FROM node_aliases WHERE node_id = ?').run(id);
        if (patch.tags !== undefined) this.db.prepare('DELETE FROM node_tags WHERE node_id = ?').run(id);
        this.writeAliasesAndTags(id, patch.aliases ?? [], patch.tags ?? []);
      }
      this.recordVersion(id, 'update', changedBy, now);
    })();
    return (await this.getNodeById(id))!;
  }

  async setStatus(id: string, status: NodeStatus, changedBy: string, supersededBy?: string): Promise<NodeRecord> {
    const now = new Date().toISOString();
    const changeType = status === 'active' ? 'restore' : status === 'superseded' ? 'supersede' : 'delete';
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE nodes SET status = ?, superseded_by = ?, version = version + 1, updated_by = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(status, status === 'superseded' ? (supersededBy ?? null) : null, changedBy, now, id);
      this.recordVersion(id, changeType, changedBy, now);
      if (status === 'active') {
        // Links made while it was deleted were stored unresolved (resolveId skips deleted nodes).
        const row = this.db.prepare('SELECT namespace, key FROM nodes WHERE id = ?').get(id) as
          { namespace: string; key: string } | undefined;
        if (row) this.resolveWaitingEdges(id, row.namespace, row.key);
      }
    })();
    return (await this.getNodeById(id))!;
  }

  async markVerified(ids: string[], at: string): Promise<void> {
    if (ids.length === 0) return;
    this.db
      .prepare(`UPDATE nodes SET last_verified_at = ?, last_wrong_at = NULL WHERE id IN (${marks(ids)})`)
      .run(at, ...ids);
  }

  async recordFeedback(ids: string[], verdict: FeedbackVerdict, at: string): Promise<void> {
    if (ids.length === 0) return;
    const set = {
      useful: 'useful_count = useful_count + 1, last_useful_at = ?',
      not_useful: 'not_useful_count = not_useful_count + 1',
      outdated_or_wrong: 'wrong_count = wrong_count + 1, last_wrong_at = ?',
    }[verdict];
    const params = verdict === 'not_useful' ? ids : [at, ...ids];
    this.db.prepare(`UPDATE nodes SET ${set} WHERE id IN (${marks(ids)})`).run(...params);
  }

  async recent(q: RecentQuery): Promise<RecentEntry[]> {
    if (q.namespaces.length === 0) return [];
    // The latest of the last write and the last useful mark.
    const at = `CASE WHEN last_useful_at > updated_at THEN last_useful_at ELSE updated_at END`;
    const where = [`status = 'active'`, `namespace IN (${marks(q.namespaces)})`];
    const params: unknown[] = [...q.namespaces];
    if (q.since) {
      where.push(`${at} >= ?`);
      params.push(q.since);
    }
    if (q.updatedBy) {
      where.push('updated_by = ?');
      params.push(q.updatedBy);
    }
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE ${where.join(' AND ')} ORDER BY ${at} DESC, id DESC LIMIT ?`)
      .all(...params, q.limit) as NodeRow[];
    return this.hydrate(rows).map((node) => {
      if (node.lastUsefulAt && node.lastUsefulAt > node.updatedAt)
        return { node, kind: 'useful', at: node.lastUsefulAt };
      return { node, kind: node.version === 1 ? 'created' : 'updated', at: node.updatedAt };
    });
  }

  async repointEdges(oldId: string, replacement: NodeRecord): Promise<number> {
    const now = new Date().toISOString();
    let moved = 0;
    this.db.transaction(() => {
      const rows = this.db
        .prepare(`SELECT * FROM edges WHERE status = 'active' AND (from_id = ? OR to_id = ?)`)
        .all(oldId, oldId) as EdgeRow[];
      const duplicate = this.db.prepare(
        `SELECT 1 FROM edges WHERE status = 'active' AND id != ? AND from_namespace = ? AND from_key = ?
           AND to_namespace = ? AND to_key = ? AND type = ?`,
      );
      const retire = this.db.prepare(
        `UPDATE edges SET status = 'deleted', version = version + 1, updated_at = ? WHERE id = ?`,
      );
      const move = this.db.prepare(
        `UPDATE edges SET from_namespace = ?, from_key = ?, from_id = ?, to_namespace = ?, to_key = ?, to_id = ?,
                version = version + 1, updated_at = ?
          WHERE id = ?`,
      );
      const here = { ns: replacement.namespace, key: replacement.key, id: replacement.id };
      for (const e of rows) {
        const from = e.from_id === oldId ? here : { ns: e.from_namespace, key: e.from_key, id: e.from_id };
        const to = e.to_id === oldId ? here : { ns: e.to_namespace, key: e.to_key, id: e.to_id };
        const selfLoop = from.ns === to.ns && from.key === to.key;
        if (selfLoop || duplicate.get(e.id, from.ns, from.key, to.ns, to.key, e.type)) {
          retire.run(now, e.id);
        } else {
          move.run(from.ns, from.key, from.id, to.ns, to.key, to.id, now, e.id);
          moved++;
        }
      }
    })();
    return moved;
  }

  async search(q: SearchQuery): Promise<SearchResult> {
    if (q.terms.length === 0 || q.namespaces.length === 0) return { nodes: [], total: 0 };
    // Quote every term so user text can never be read as FTS5 syntax.
    const match = q.terms
      .map((t) => `"${t.replaceAll('"', '""')}"${q.prefix ? '*' : ''}`)
      .join(q.match === 'all' ? ' AND ' : ' OR ');
    const statuses = q.statuses ?? ['active'];
    const where = [`nodes_fts MATCH ?`, `n.status IN (${marks(statuses)})`, `n.namespace IN (${marks(q.namespaces)})`];
    const params: unknown[] = [match, ...statuses, ...q.namespaces];
    if (q.type) {
      where.push('n.type = ?');
      params.push(q.type);
    }
    if (q.ids) {
      where.push(`n.id IN (${marks(q.ids)})`);
      params.push(...q.ids);
    }
    if (q.tag) {
      where.push('EXISTS (SELECT 1 FROM node_tags t WHERE t.node_id = n.id AND t.tag = ?)');
      params.push(q.tag);
    }
    const from = `FROM nodes_fts JOIN nodes n ON n.rowid = nodes_fts.rowid WHERE ${where.join(' AND ')}`;

    // bm25 is negative (lower is better). Column weights: title, summary, body, aliases, tags.
    // Nodes marked useful get at most a 10% boost (ADR 0005: keep it small).
    const rows = this.db
      .prepare(
        `SELECT n.* ${from}
         ORDER BY bm25(nodes_fts, 10.0, 5.0, 1.0, 5.0, 3.0) * (1.0 + 0.1 * min(n.useful_count, 5) / 5.0)
         LIMIT ?`,
      )
      .all(...params, q.limit) as NodeRow[];
    const { total } = this.db.prepare(`SELECT count(*) AS total ${from}`).get(...params) as { total: number };
    return { nodes: this.hydrate(rows), total };
  }

  async upsertEdge(edge: NewEdge): Promise<{ edge: EdgeRecord; created: boolean }> {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(
        `SELECT * FROM edges WHERE status = 'active' AND from_namespace = ? AND from_key = ?
           AND to_namespace = ? AND to_key = ? AND type = ?`,
      )
      .get(edge.fromNamespace, edge.fromKey, edge.toNamespace, edge.toKey, edge.type) as EdgeRow | undefined;

    if (existing) {
      if (edge.note !== null && edge.note !== existing.note) {
        this.db
          .prepare('UPDATE edges SET note = ?, version = version + 1, updated_at = ? WHERE id = ?')
          .run(edge.note, now, existing.id);
      }
      return { edge: this.edgeById(existing.id), created: false };
    }

    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO edges (id, from_namespace, from_key, to_namespace, to_key, from_id, to_id,
                            type, note, source, author, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        edge.fromNamespace,
        edge.fromKey,
        edge.toNamespace,
        edge.toKey,
        this.resolveId(edge.fromNamespace, edge.fromKey),
        this.resolveId(edge.toNamespace, edge.toKey),
        edge.type,
        edge.note,
        edge.source,
        edge.author,
        now,
        now,
      );
    return { edge: this.edgeById(id), created: true };
  }

  async neighbors(nodeId: string): Promise<Neighbor[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM edges WHERE status = 'active' AND (from_id = ? OR to_id = ?)
         ORDER BY type, created_at`,
      )
      .all(nodeId, nodeId) as EdgeRow[];
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
    const rows = this.db
      .prepare(
        `SELECT n.id AS id,
                (SELECT count(*) FROM edges e
                  WHERE e.status = 'active' AND (e.from_id = n.id OR e.to_id = n.id)) AS count
           FROM nodes n WHERE n.id IN (${marks(nodeIds)})`,
      )
      .all(...nodeIds) as { id: string; count: number }[];
    return new Map(rows.map((r) => [r.id, r.count]));
  }

  // Rows made in the same millisecond tie on created_at, and ULIDs are random within a
  // millisecond, so rowid (insertion order) breaks the tie.
  async listNodes(namespaces: string[]): Promise<NodeRecord[]> {
    if (namespaces.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE namespace IN (${marks(namespaces)}) ORDER BY created_at, rowid`)
      .all(...namespaces) as NodeRow[];
    return this.hydrate(rows);
  }

  async listEdges(namespaces: string[]): Promise<EdgeRecord[]> {
    if (namespaces.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT * FROM edges WHERE status = 'active' AND from_namespace IN (${marks(namespaces)})
         ORDER BY created_at, rowid`,
      )
      .all(...namespaces) as EdgeRow[];
    return rows.map(toEdge);
  }

  async stats(namespaces: string[]): Promise<GraphStats> {
    if (namespaces.length === 0) return { nodes: 0, nodeTypes: [], edgeTypes: [] };
    const ns = marks(namespaces);
    const nodeTypes = this.db
      .prepare(
        `SELECT type AS name, count(*) AS count FROM nodes
          WHERE status = 'active' AND namespace IN (${ns})
          GROUP BY type ORDER BY count DESC, type`,
      )
      .all(...namespaces) as { name: string; count: number }[];
    const edgeTypes = this.db
      .prepare(
        `SELECT type AS name, count(*) AS count FROM edges
          WHERE status = 'active' AND from_namespace IN (${ns})
          GROUP BY type ORDER BY count DESC, type`,
      )
      .all(...namespaces) as { name: string; count: number }[];
    return { nodes: nodeTypes.reduce((sum, t) => sum + t.count, 0), nodeTypes, edgeTypes };
  }

  async getSettings(namespaces: string[], key: string): Promise<SettingRow[]> {
    if (namespaces.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT namespace, scope, value FROM settings WHERE key = ? AND namespace IN (${marks(namespaces)})`)
      .all(key, ...namespaces) as { namespace: string; scope: string; value: string }[];
    return rows.map((r) => ({ namespace: r.namespace, scope: r.scope, value: JSON.parse(r.value) }));
  }

  async putSetting(namespace: string, scope: string, key: string, value: unknown): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO settings (namespace, scope, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (namespace, scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(namespace, scope, key, JSON.stringify(value), new Date().toISOString());
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // --- helpers ---------------------------------------------------------

  private writeAliasesAndTags(id: string, aliases: string[], tags: string[]): void {
    const alias = this.db.prepare('INSERT OR IGNORE INTO node_aliases (node_id, alias) VALUES (?, ?)');
    for (const a of aliases) alias.run(id, a);
    const tag = this.db.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)');
    for (const t of tags) tag.run(id, t);
  }

  /** Snapshot of the node as it stands now, stored under its current version. */
  private recordVersion(id: string, changeType: string, changedBy: string, at: string): void {
    const node = this.hydrate([this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow])[0]!;
    this.db
      .prepare(
        `INSERT INTO node_versions (node_id, version, snapshot, body_len, change_type, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, node.version, JSON.stringify(node), node.body?.length ?? 0, changeType, changedBy, at);
  }

  private resolveWaitingEdges(id: string, namespace: string, key: string): void {
    this.db
      .prepare('UPDATE edges SET to_id = ? WHERE to_namespace = ? AND to_key = ? AND to_id IS NULL')
      .run(id, namespace, key);
    this.db
      .prepare('UPDATE edges SET from_id = ? WHERE from_namespace = ? AND from_key = ? AND from_id IS NULL')
      .run(id, namespace, key);
  }

  private resolveId(namespace: string, key: string): string | null {
    const row = this.db
      .prepare(`SELECT id FROM nodes WHERE namespace = ? AND key = ? AND status != 'deleted'`)
      .get(namespace, key) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private edgeById(id: string): EdgeRecord {
    return toEdge(this.db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow);
  }

  /** Row → record, loading aliases and tags in one query each. */
  private hydrate(rows: NodeRow[]): NodeRecord[] {
    if (rows.length === 0) return [];
    // One parameter per id, so big lists go in batches under SQLite's variable limit (32,766).
    const lookup = (sql: (ids: string) => string) => {
      const found: { node_id: string; v: string }[] = [];
      for (let i = 0; i < rows.length; i += HYDRATE_BATCH) {
        const ids = rows.slice(i, i + HYDRATE_BATCH).map((r) => r.id);
        found.push(...(this.db.prepare(sql(marks(ids))).all(...ids) as { node_id: string; v: string }[]));
      }
      return groupBy(found);
    };
    const aliases = lookup(
      (ids) => `SELECT node_id, alias AS v FROM node_aliases WHERE node_id IN (${ids}) ORDER BY alias`,
    );
    const tags = lookup((ids) => `SELECT node_id, tag AS v FROM node_tags WHERE node_id IN (${ids}) ORDER BY tag`);
    return rows.map((r) => ({
      id: r.id,
      namespace: r.namespace,
      key: r.key,
      type: r.type,
      title: r.title,
      summary: r.summary,
      body: r.body,
      properties: JSON.parse(r.properties) as Record<string, unknown>,
      aliases: aliases.get(r.id) ?? [],
      tags: tags.get(r.id) ?? [],
      status: r.status as NodeRecord['status'],
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
    }));
  }
}

interface NodeRow {
  id: string;
  namespace: string;
  key: string;
  type: string;
  title: string;
  summary: string | null;
  body: string | null;
  properties: string;
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

// Ids per lookup in hydrate(), well under SQLite's 32,766 variable limit.
const HYDRATE_BATCH = 10_000;

function marks(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function groupBy(rows: unknown[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows as { node_id: string; v: string }[]) {
    const list = out.get(row.node_id) ?? [];
    list.push(row.v);
    out.set(row.node_id, list);
  }
  return out;
}
