import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VersionConflictError, type GraphStore, type NewNode } from '../../src/store/GraphStore.js';

/**
 * The contract every GraphStore must meet. SQLite runs it now; the Postgres
 * adapter (v0.3) runs the same suite.
 */
export function graphStoreSuite(name: string, makeStore: () => Promise<GraphStore>): void {
  describe(`GraphStore: ${name}`, () => {
    let store: GraphStore;
    beforeEach(async () => {
      store = await makeStore();
    });
    afterEach(async () => {
      await store.close();
    });

    const node = (overrides: Partial<NewNode> = {}): NewNode => ({
      namespace: 'default',
      key: 'concept/permissions',
      type: 'concept',
      title: 'Permission system',
      summary: 'Roles grant actions; groups hold roles.',
      body: 'A user’s effective permissions are the union of the roles on every group they belong to.',
      properties: { owner: 'platform' },
      aliases: ['perms', 'access control'],
      tags: ['auth', 'core'],
      source: 'local',
      author: 'local',
      ...overrides,
    });

    describe('nodes', () => {
      it('creates a node at version 1 and reads it back by key and id', async () => {
        const created = await store.createNode(node());
        expect(created.version).toBe(1);
        expect(created.status).toBe('active');
        expect(created.aliases).toEqual(['access control', 'perms']);
        expect(created.tags).toEqual(['auth', 'core']);
        expect(created.properties).toEqual({ owner: 'platform' });

        expect((await store.getNode('default', 'concept/permissions'))?.id).toBe(created.id);
        expect((await store.getNodeById(created.id))?.key).toBe('concept/permissions');
        expect(await store.getNode('default', 'concept/nope')).toBeNull();
      });

      it('updates only the patched fields and bumps the version', async () => {
        const created = await store.createNode(node());
        const updated = await store.updateNode(created.id, { title: 'Permissions', tags: ['auth'] }, 'alice');
        expect(updated.version).toBe(2);
        expect(updated.title).toBe('Permissions');
        expect(updated.summary).toBe(created.summary);
        expect(updated.tags).toEqual(['auth']);
        expect(updated.aliases).toEqual(created.aliases);
        expect(updated.updatedBy).toBe('alice');
      });

      it('rejects an update against a stale version', async () => {
        const created = await store.createNode(node());
        await store.updateNode(created.id, { title: 'v2' }, 'local', 1);
        await expect(store.updateNode(created.id, { title: 'v3' }, 'local', 1)).rejects.toBeInstanceOf(
          VersionConflictError,
        );
        expect((await store.getNodeById(created.id))?.title).toBe('v2');
      });
    });

    describe('search', () => {
      beforeEach(async () => {
        await store.createNode(node());
        await store.createNode(
          node({
            key: 'how-to/grant-admin',
            type: 'how-to',
            title: 'Granting admin access',
            summary: 'Use the console, not SQL.',
            body: 'Open the admin console and pick a role.',
            aliases: [],
            tags: ['auth'],
          }),
        );
        await store.createNode(
          node({
            key: 'concept/billing',
            title: 'Billing pipeline',
            summary: 'Invoices nightly.',
            body: null,
            aliases: [],
            tags: [],
          }),
        );
      });

      const q = { namespaces: ['default'], match: 'all' as const, limit: 10 };

      it('matches word stems', async () => {
        const { nodes } = await store.search({ ...q, terms: ['permission'] });
        expect(nodes.map((n) => n.key)).toEqual(['concept/permissions']);
      });

      it('searches aliases and tags', async () => {
        expect((await store.search({ ...q, terms: ['perms'] })).nodes[0]?.key).toBe('concept/permissions');
        expect((await store.search({ ...q, terms: ['auth'] })).total).toBe(2);
      });

      it('ranks title matches above body matches', async () => {
        const { nodes } = await store.search({ ...q, terms: ['admin'] });
        expect(nodes[0]?.key).toBe('how-to/grant-admin');
      });

      it('filters by type and tag', async () => {
        expect((await store.search({ ...q, terms: ['auth'], type: 'how-to' })).nodes.map((n) => n.key)).toEqual([
          'how-to/grant-admin',
        ]);
        expect((await store.search({ ...q, terms: ['roles'], tag: 'core' })).total).toBe(1);
        expect((await store.search({ ...q, terms: ['roles'], tag: 'nope' })).total).toBe(0);
      });

      it('reports the total beyond the limit', async () => {
        const result = await store.search({ ...q, terms: ['auth'], limit: 1 });
        expect(result.nodes).toHaveLength(1);
        expect(result.total).toBe(2);
      });

      it("requires every term for 'all' and any term for 'any'", async () => {
        expect((await store.search({ ...q, terms: ['billing', 'roles'] })).total).toBe(0);
        // "roles" also stems to match "role" in the how-to body.
        expect((await store.search({ ...q, terms: ['billing', 'roles'], match: 'any' })).total).toBe(3);
      });

      it('ranks a node marked useful above an equal match', async () => {
        const a = await store.createNode(
          node({ key: 'note/a', title: 'Deploy checklist', summary: null, body: null, aliases: [], tags: [] }),
        );
        const b = await store.createNode(
          node({ key: 'note/b', title: 'Deploy checklist', summary: null, body: null, aliases: [], tags: [] }),
        );
        await store.recordFeedback([b.id], 'useful', new Date().toISOString());
        expect((await store.search({ ...q, terms: ['deploy'] })).nodes.map((n) => n.id)).toEqual([b.id, a.id]);
      });

      it('stamps when a node was last marked outdated or wrong', async () => {
        const n = await store.createNode(node({ key: 'note/c', title: 'C', aliases: [], tags: [] }));
        await store.recordFeedback([n.id], 'outdated_or_wrong', '2030-01-01T00:00:00.000Z');
        const [after] = await store.getNodesByIds([n.id]).then((m) => [...m.values()]);
        expect([after?.wrongCount, after?.lastWrongAt]).toEqual([1, '2030-01-01T00:00:00.000Z']);
      });

      it('matches prefixes when asked', async () => {
        expect((await store.search({ ...q, terms: ['perm'], prefix: true })).nodes[0]?.key).toBe('concept/permissions');
      });

      it('treats FTS syntax in terms as plain text', async () => {
        await expect(store.search({ ...q, terms: ['"OR', 'NEAR('] })).resolves.toBeDefined();
      });

      it('only sees the given namespaces', async () => {
        await store.createNode(node({ namespace: 'other', key: 'concept/permissions' }));
        expect((await store.search({ ...q, terms: ['permission'] })).total).toBe(1);
        expect((await store.search({ ...q, namespaces: ['default', 'other'], terms: ['permission'] })).total).toBe(2);
      });

      it('reflects updates to text, aliases and tags', async () => {
        const n = (await store.getNode('default', 'concept/billing'))!;
        await store.updateNode(n.id, { summary: 'Invoices go out through Stripe.', aliases: ['payments'] }, 'local');
        expect((await store.search({ ...q, terms: ['stripe'] })).total).toBe(1);
        expect((await store.search({ ...q, terms: ['payments'] })).total).toBe(1);
        expect((await store.search({ ...q, terms: ['nightly'] })).total).toBe(0);
      });
    });

    describe('edges', () => {
      const edge = (from: string, to: string, type = 'depends_on') => ({
        fromNamespace: 'default',
        fromKey: from,
        toNamespace: 'default',
        toKey: to,
        type,
        note: null,
        source: 'local',
        author: 'local',
      });

      it('lists every node by namespace, any status, and the active edges', async () => {
        const a = await store.createNode(node());
        const b = await store.createNode(node({ key: 'concept/roles', title: 'Roles' }));
        await store.createNode(node({ namespace: 'other', key: 'concept/elsewhere', title: 'Elsewhere' }));
        await store.setStatus(b.id, 'deleted', 'local');
        await store.upsertEdge(edge('concept/permissions', 'concept/roles'));
        await store.upsertEdge(edge('concept/permissions', 'concept/audit-log', 'references'));

        const nodes = await store.listNodes(['default']);
        expect(nodes.map((n) => [n.key, n.status])).toEqual([
          ['concept/permissions', 'active'],
          ['concept/roles', 'deleted'],
        ]);
        expect(nodes[0]!.aliases).toEqual(a.aliases);
        const edges = await store.listEdges(['default']);
        expect(edges.map((e) => e.toKey).sort()).toEqual(['concept/audit-log', 'concept/roles']);
        expect(await store.listNodes([])).toEqual([]);
        expect(await store.listEdges(['other'])).toEqual([]);
      });

      it('upserts on (from, to, type)', async () => {
        await store.createNode(node());
        await store.createNode(node({ key: 'concept/roles', title: 'Roles' }));
        const first = await store.upsertEdge(edge('concept/permissions', 'concept/roles'));
        const again = await store.upsertEdge({ ...edge('concept/permissions', 'concept/roles'), note: 'core link' });
        expect(first.created).toBe(true);
        expect(again.created).toBe(false);
        expect(again.edge.id).toBe(first.edge.id);
        expect(again.edge.note).toBe('core link');
        expect((await store.upsertEdge(edge('concept/permissions', 'concept/roles', 'references'))).created).toBe(true);
      });

      it('stores an edge to a missing node and resolves it when the node is created', async () => {
        const from = await store.createNode(node());
        const { edge: e } = await store.upsertEdge(edge('concept/permissions', 'concept/audit-log'));
        expect(e.toId).toBeNull();
        expect((await store.neighbors(from.id))[0]?.other).toBeNull();

        const target = await store.createNode(node({ key: 'concept/audit-log', title: 'Audit log' }));
        const [n] = await store.neighbors(from.id);
        expect(n?.edge.toId).toBe(target.id);
        expect(n?.other?.title).toBe('Audit log');
      });

      it('lists neighbors in both directions and counts edges', async () => {
        const perms = await store.createNode(node());
        const roles = await store.createNode(node({ key: 'concept/roles', title: 'Roles' }));
        await store.upsertEdge(edge('concept/permissions', 'concept/roles'));
        await store.upsertEdge(edge('concept/roles', 'concept/permissions', 'part_of'));

        const fromPerms = await store.neighbors(perms.id);
        expect(fromPerms.map((n) => [n.direction, n.edge.type, n.otherKey])).toEqual([
          ['out', 'depends_on', 'concept/roles'],
          ['in', 'part_of', 'concept/roles'],
        ]);
        const counts = await store.edgeCounts([perms.id, roles.id]);
        expect(counts.get(perms.id)).toBe(2);
        expect(counts.get(roles.id)).toBe(2);
      });
    });

    describe('stats and settings', () => {
      it('counts active nodes and types per namespace', async () => {
        await store.createNode(node());
        await store.createNode(node({ key: 'concept/roles', title: 'Roles' }));
        await store.createNode(node({ key: 'how-to/x', type: 'how-to', title: 'X' }));
        await store.createNode(node({ namespace: 'other', key: 'note/y', type: 'note', title: 'Y' }));
        await store.upsertEdge({
          fromNamespace: 'default',
          fromKey: 'concept/roles',
          toNamespace: 'default',
          toKey: 'concept/permissions',
          type: 'part_of',
          note: null,
          source: 'local',
          author: 'local',
        });
        const stats = await store.stats(['default']);
        expect(stats.nodes).toBe(3);
        expect(stats.nodeTypes).toEqual([
          { name: 'concept', count: 2 },
          { name: 'how-to', count: 1 },
        ]);
        expect(stats.edgeTypes).toEqual([{ name: 'part_of', count: 1 }]);
      });

      it('stores settings as JSON per namespace and scope', async () => {
        await store.putSetting('default', 'team', 'house_rules', ['Tickets are keyed by Jira ID.']);
        await store.putSetting('default', 'team', 'house_rules', ['Rule two.']);
        await store.putSetting('other', 'team', 'house_rules', ['Elsewhere.']);
        expect(await store.getSettings(['default'], 'house_rules')).toEqual([
          { namespace: 'default', scope: 'team', value: ['Rule two.'] },
        ]);
      });
    });
  });
}
