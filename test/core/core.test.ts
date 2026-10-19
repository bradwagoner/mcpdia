import { beforeEach, describe, expect, it } from 'vitest';
import { soloContext } from '../../src/context.js';
import { UserError } from '../../src/core/errors.js';
import { get } from '../../src/core/get.js';
import { link } from '../../src/core/link.js';
import { orient } from '../../src/core/orient.js';
import { search, searchTerms } from '../../src/core/search.js';
import { upsert } from '../../src/core/upsert.js';
import type { GraphStore } from '../../src/store/GraphStore.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';

const ctx = soloContext();
let store: GraphStore;

beforeEach(() => {
  store = new SqliteStore(':memory:');
});

const perms = { type: 'Concept', title: 'Permission system', summary: 'Roles grant actions; groups hold roles.' };

describe('upsert', () => {
  it('creates a node with a key built from type and title', async () => {
    const out = await upsert(ctx, store, perms);
    expect(out.created).toBe(true);
    expect(out.node.key).toBe('concept/permission-system');
    expect(out.node.type).toBe('concept');
  });

  it('refuses to create a second node with the same derived key', async () => {
    await upsert(ctx, store, perms);
    const err = await upsert(ctx, store, perms).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as UserError).hint).toContain('pass key: concept/permission-system');
  });

  it('updates by key, changing only what was passed', async () => {
    await upsert(ctx, store, { ...perms, body: 'Long text.', tags: ['auth'] });
    const out = await upsert(ctx, store, { key: 'concept/permission-system', type: 'concept', title: 'Permissions' });
    expect(out.created).toBe(false);
    expect(out.node.version).toBe(2);
    expect(out.node.title).toBe('Permissions');
    expect(out.node.body).toBe('Long text.');
    expect(out.node.tags).toEqual(['auth']);
  });

  it('creates at a caller-chosen key', async () => {
    const out = await upsert(ctx, store, { key: 'ticket/PROJ-123', type: 'ticket', title: 'CSV export' });
    expect(out.created).toBe(true);
    expect(out.node.key).toBe('ticket/PROJ-123');
  });

  it('turns a stale version into a readable error', async () => {
    await upsert(ctx, store, perms);
    const key = 'concept/permission-system';
    await upsert(ctx, store, { key, type: 'concept', title: 'v2', version: 1 });
    await expect(upsert(ctx, store, { key, type: 'concept', title: 'v3', version: 1 })).rejects.toThrow(
      'it is at v2, not v1',
    );
  });

  it('points out a new type but still writes', async () => {
    await upsert(ctx, store, { type: 'ticket', title: 'One' });
    const out = await upsert(ctx, store, { type: 'Tickets', title: 'Two' });
    expect(out.created).toBe(true);
    expect(out.typeHint).toBe('Type "tickets" is new here. list_types shows the types in use.');
    expect((await upsert(ctx, store, { type: 'ticket', title: 'Three' })).typeHint).toBeUndefined();
  });

  it('rejects writes to a namespace that is not loaded', async () => {
    await expect(upsert(ctx, store, { key: 'dev:concept/x', type: 'concept', title: 'X' })).rejects.toThrow(
      'Namespace dev is not loaded.',
    );
  });
});

describe('upsert links and the parent hint', () => {
  const task = (title: string, links?: { type: string; to: string }[]) =>
    upsert(ctx, store, { type: 'task', title, links });
  const parents = async (key: string) => {
    const node = await store.getNode('default', key);
    return (await store.neighbors(node!.id)).map((n) => `${n.edge.type} ${n.otherKey}`).sort();
  };

  it('writes links with the node, including to a node that does not exist yet', async () => {
    const out = await task('Ship it', [
      { type: 'Part Of', to: 'plan/launch' },
      { type: 'depends_on', to: 'task/missing' },
    ]);
    expect(out.links.map((l) => [l.edge.type, l.toKey, l.toMissing])).toEqual([
      ['part_of', 'plan/launch', true],
      ['depends_on', 'task/missing', true],
    ]);
    expect(await parents('task/ship-it')).toEqual(['depends_on task/missing', 'part_of plan/launch']);
    expect(out.parentHint).toBeUndefined();
  });

  it('links from the saved node even when its key looks like a namespace', async () => {
    const out = await upsert(ctx, store, {
      type: 'schema:Person',
      title: 'Ada',
      links: [{ type: 'part_of', to: 'plan/launch' }],
    });
    expect(out.links[0]?.edge.fromKey).toBe(out.node.key);
    expect(out.links[0]?.edge.fromNamespace).toBe(out.node.namespace);
  });

  it('adds links on update and keeps the ones already there', async () => {
    await task('Ship it', [{ type: 'part_of', to: 'plan/launch' }]);
    await upsert(ctx, store, {
      key: 'task/ship-it',
      type: 'task',
      title: 'Ship it',
      links: [{ type: 'references', to: 'note/x' }],
    });
    expect(await parents('task/ship-it')).toEqual(['part_of plan/launch', 'references note/x']);
  });

  it('checks every link before writing anything', async () => {
    await expect(task('Ship it', [{ type: ' ', to: 'plan/launch' }])).rejects.toThrow('A link type is empty.');
    await expect(task('Ship it', [{ type: 'part_of', to: '01JZZZZZZZZZZZZZZZZZZZZZZZ' }])).rejects.toThrow('Not found');
    expect(await store.getNode('default', 'task/ship-it')).toBeNull();
  });

  it('says when a node is created with no parent', async () => {
    const out = await task('Loose end');
    expect(out.parentHint).toBe(
      'task/loose-end has no parent. Most nodes sit under something, so this is probably not right; link it with part_of unless it starts something new.',
    );
  });

  it('names no candidate parent, even when recent writes share one', async () => {
    await task('One', [{ type: 'part_of', to: 'plan/launch' }]);
    await task('Two', [{ type: 'part_of', to: 'plan/launch' }]);
    expect((await task('Three')).parentHint).not.toContain('plan/launch');
  });

  it('covers every type, and leaves updates alone', async () => {
    expect((await upsert(ctx, store, perms)).parentHint).toContain('has no parent.');
    await task('Loose end');
    expect(
      (await upsert(ctx, store, { key: 'task/loose-end', type: 'task', title: 'Loose end' })).parentHint,
    ).toBeUndefined();
  });
});

describe('search', () => {
  it('falls back to any-word matching when all words find nothing', async () => {
    await upsert(ctx, store, perms);
    await upsert(ctx, store, { type: 'concept', title: 'Billing pipeline' });
    const out = await search(ctx, store, { query: 'billing permissions', level: 'summary', limit: 10 });
    expect(out.total).toBe(2);
    expect(out.partial).toBe(true);
    expect(out.hits.every((h) => h.edgeCount === 0)).toBe(true);
  });

  it('tops up a short every-word result with partial matches', async () => {
    await upsert(ctx, store, { type: 'concept', title: 'Billing permissions' });
    await upsert(ctx, store, perms);
    await upsert(ctx, store, { type: 'concept', title: 'Billing pipeline' });
    const out = await search(ctx, store, { query: 'billing permissions', level: 'title', limit: 10 });
    expect(out).toMatchObject({ total: 3, fullMatches: 1, partial: false });
    expect(out.hits[0]).toMatchObject({ node: { title: 'Billing permissions' }, matched: undefined });
    const rest = Object.fromEntries(out.hits.slice(1).map((h) => [h.node.title, h.matched]));
    expect(rest).toEqual({ 'Permission system': ['permissions'], 'Billing pipeline': ['billing'] });
  });

  it('keeps to the limit and never repeats a node', async () => {
    await upsert(ctx, store, { type: 'concept', title: 'Billing permissions' });
    await upsert(ctx, store, perms);
    await upsert(ctx, store, { type: 'concept', title: 'Billing pipeline' });
    const two = await search(ctx, store, { query: 'billing permissions', level: 'title', limit: 2 });
    expect(two.hits.map((h) => h.node.title)).toEqual(['Billing permissions', two.hits[1]!.node.title]);
    expect(two.total).toBe(3);
    const one = await search(ctx, store, { query: 'billing permissions', level: 'title', limit: 1 });
    expect(one.hits.map((h) => h.node.title)).toEqual(['Billing permissions']);
    expect(one.fullMatches).toBe(1);
  });

  it('is not partial when every word matches', async () => {
    await upsert(ctx, store, perms);
    expect((await search(ctx, store, { query: 'permission roles', level: 'title', limit: 10 })).partial).toBe(false);
  });

  it('drops question words unless they are all there is', () => {
    expect(searchTerms('What is left for v0.1?')).toEqual(['left', 'v0', '1']);
    expect(searchTerms('how to')).toEqual(['how', 'to']);
  });

  it('reports a miss as empty, not partial', async () => {
    await upsert(ctx, store, perms);
    const out = await search(ctx, store, { query: 'what about invoices', level: 'title', limit: 10 });
    expect(out).toMatchObject({ total: 0, partial: false });
  });

  it('rejects a query with no words', async () => {
    await expect(search(ctx, store, { query: '?!', level: 'title', limit: 10 })).rejects.toBeInstanceOf(UserError);
  });
});

describe('link and get', () => {
  beforeEach(async () => {
    await upsert(ctx, store, { key: 'concept/permissions', ...perms });
    await upsert(ctx, store, { key: 'concept/roles', type: 'concept', title: 'Roles' });
  });

  it('links nodes, normalizing the edge type', async () => {
    const out = await link(ctx, store, { from: 'concept/permissions', to: 'concept/roles', type: 'Depends On' });
    expect(out.created).toBe(true);
    expect(out.edge.type).toBe('depends_on');
    expect(out.toMissing).toBe(false);
    expect(out.typeHint).toBeUndefined();
  });

  it('links to a node that does not exist yet', async () => {
    const out = await link(ctx, store, { from: 'concept/permissions', to: 'concept/audit-log', type: 'references' });
    expect(out.toMissing).toBe(true);
    const [item] = await get(ctx, store, { keys: ['concept/permissions'], neighbors: true });
    expect(item?.node && 'neighbors' in item ? item.neighbors : []).toEqual([
      { direction: 'out', type: 'references', key: 'concept/audit-log', node: null },
    ]);
  });

  it('leaves out neighbors in namespaces the caller cannot read', async () => {
    await link(ctx, store, { from: 'concept/permissions', to: 'concept/roles', type: 'depends_on' });
    const both = { ...ctx, namespaces: ['default', 'secret'] };
    await link(both, store, { from: 'concept/permissions', to: 'secret:concept/plans', type: 'references' });
    const [item] = await get(ctx, store, { keys: ['concept/permissions'], neighbors: true });
    expect(item?.node && 'neighbors' in item ? item.neighbors?.map((n) => n.key) : []).toEqual(['concept/roles']);
  });

  it('refuses to link from a missing node', async () => {
    await expect(link(ctx, store, { from: 'concept/nope', to: 'concept/roles', type: 'part_of' })).rejects.toThrow(
      'Not found: concept/nope.',
    );
  });

  it('fetches several keys and reports a missing one', async () => {
    const items = await get(ctx, store, { keys: ['concept/roles', 'concept/permision'], neighbors: false });
    expect(items[0]?.node?.title).toBe('Roles');
    expect(items[1]).toEqual({
      ref: 'concept/permision',
      node: null,
      deleted: false,
    });
  });

  it('caps keys per call with the get.max_keys setting', async () => {
    const keys = Array.from({ length: 11 }, (_, i) => `concept/k${i}`);
    await expect(get(ctx, store, { keys, neighbors: false })).rejects.toThrow('get takes up to 10 per call');
    await store.putSetting('default', 'team', 'get.max_keys', 20);
    await expect(get(ctx, store, { keys, neighbors: false })).resolves.toHaveLength(11);
  });
});

describe('orient', () => {
  it('says so when the graph is empty', async () => {
    const out = await orient(ctx, store, {});
    expect(out.empty).toBe(true);
    expect(out.stats).toBeUndefined();
  });

  it('shows counts, house rules, pinned nodes and focus matches', async () => {
    await upsert(ctx, store, { key: 'concept/permissions', ...perms });
    await upsert(ctx, store, { type: 'how-to', title: 'Onboarding' });
    await store.putSetting('default', 'team', 'house_rules', ['Tickets are keyed by Jira ID.']);
    await store.putSetting('default', 'team', 'pinned', ['how-to/onboarding', 'concept/missing']);

    const out = await orient(ctx, store, { focus: 'permission roles' });
    expect(out.houseRules).toEqual(['Tickets are keyed by Jira ID.']);
    expect(out.stats).toMatchObject({ nodes: 2, nodeTypes: 2, topTypes: ['concept', 'how-to'] });
    expect(out.pinned.map((n) => n.key)).toEqual(['how-to/onboarding']);
    expect(out.focus?.nodes.map((n) => n.key)).toEqual(['concept/permissions']);
  });

  it('follows the preset, with the caller’s own layer winning', async () => {
    await upsert(ctx, store, perms);
    await store.putSetting('default', 'team', 'orient', { preset: 'minimal' });
    expect((await orient(ctx, store, { focus: 'permission' })).stats).toBeUndefined();
    expect((await orient(ctx, store, { focus: 'permission' })).focus).toBeUndefined();

    await store.putSetting('default', 'user:local', 'orient', { focus: true });
    const out = await orient(ctx, store, { focus: 'permission' });
    expect(out.stats).toBeUndefined();
    expect(out.focus?.nodes).toHaveLength(1);
  });
});
