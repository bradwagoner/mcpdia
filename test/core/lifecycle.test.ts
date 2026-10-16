import { beforeEach, describe, expect, it } from 'vitest';
import { soloContext } from '../../src/context.js';
import { annotate } from '../../src/core/annotate.js';
import { get } from '../../src/core/get.js';
import { feedback, softDelete, supersede, verify } from '../../src/core/lifecycle.js';
import { link } from '../../src/core/link.js';
import { parseSince, recent } from '../../src/core/recent.js';
import { search } from '../../src/core/search.js';
import { listTypes } from '../../src/core/types.js';
import { upsert } from '../../src/core/upsert.js';
import type { GraphStore } from '../../src/store/GraphStore.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';

const ctx = soloContext();
let store: GraphStore;

beforeEach(async () => {
  store = new SqliteStore(':memory:');
  await upsert(ctx, store, {
    key: 'concept/permissions',
    type: 'concept',
    title: 'Permission system',
    body: 'Original.',
  });
  await upsert(ctx, store, { key: 'concept/roles', type: 'concept', title: 'Roles' });
});

const node = async (key: string) => (await store.getNode('default', key))!;

describe('annotate', () => {
  it('creates a linked note and leaves the target untouched', async () => {
    const out = await annotate(ctx, store, { on: 'concept/permissions', text: 'Cache is 5 min.\nSeen in prod logs.' });
    expect(out.noteKey).toBe('note/cache-is-5-min');
    expect(out.note).toMatchObject({
      type: 'note',
      title: 'Cache is 5 min.',
      body: 'Cache is 5 min.\nSeen in prod logs.',
    });

    const target = await node('concept/permissions');
    expect(target.version).toBe(1);
    expect(target.body).toBe('Original.');
    const [neighbor] = await store.neighbors(target.id);
    expect(neighbor).toMatchObject({ direction: 'in', otherKey: 'note/cache-is-5-min' });
    expect(neighbor?.edge.type).toBe('comments_on');
  });

  it('gives notes with the same text distinct keys', async () => {
    await annotate(ctx, store, { on: 'concept/permissions', text: 'Flaky' });
    const second = await annotate(ctx, store, { on: 'concept/roles', text: 'Flaky' });
    expect(second.noteKey).toBe('note/flaky-2');
    expect(second.note.body).toBeNull();
  });

  it('refuses a missing target', async () => {
    await expect(annotate(ctx, store, { on: 'concept/nope', text: 'x' })).rejects.toThrow('Not found: concept/nope.');
  });
});

describe('supersede', () => {
  beforeEach(async () => {
    await link(ctx, store, { from: 'concept/roles', to: 'concept/permissions', type: 'part_of' });
    await annotate(ctx, store, { on: 'concept/permissions', text: 'Old note' });
  });

  it('creates the replacement, moves links and keeps history', async () => {
    const out = await supersede(ctx, store, { old: 'concept/permissions', title: 'Permission system', body: 'New.' });
    expect(out.newKey).toBe('concept/permission-system');
    expect(out.created).toBe(true);
    expect(out.movedEdges).toBe(2);

    const old = await node('concept/permissions');
    expect(old.status).toBe('superseded');
    expect(old.supersededBy).toBe(out.replacement.id);

    const links = (await store.neighbors(out.replacement.id)).map((n) => `${n.direction} ${n.edge.type} ${n.otherKey}`);
    expect(links.sort()).toEqual([
      'in comments_on note/old-note',
      'in part_of concept/roles',
      'out supersedes concept/permissions',
    ]);
    const [item] = await get(ctx, store, { keys: ['concept/permissions'], neighbors: false });
    expect(item && 'supersededByKey' in item ? item.supersededByKey : undefined).toBe('concept/permission-system');
  });

  it('can point at an existing node, dropping links that would duplicate or loop', async () => {
    await link(ctx, store, { from: 'concept/roles', to: 'concept/permissions', type: 'depends_on' });
    await link(ctx, store, { from: 'concept/permissions', to: 'concept/roles', type: 'references' });
    const out = await supersede(ctx, store, { old: 'concept/permissions', new: 'concept/roles' });
    expect(out.created).toBe(false);
    // The note moves; the three links between the two nodes would become self-loops.
    expect(out.movedEdges).toBe(1);
  });

  it('refuses to supersede a node with itself or twice', async () => {
    await expect(supersede(ctx, store, { old: 'concept/permissions', new: 'concept/permissions' })).rejects.toThrow(
      'cannot supersede itself',
    );
    await supersede(ctx, store, { old: 'concept/permissions', new: 'concept/roles' });
    await expect(supersede(ctx, store, { old: 'concept/permissions', new: 'concept/roles' })).rejects.toThrow(
      'concept/permissions is superseded by concept/roles.',
    );
  });
});

describe('verify, delete and feedback', () => {
  it('verifies without a new version', async () => {
    const out = await verify(ctx, store, ['concept/permissions', 'concept/nope']);
    expect(out).toEqual({ done: ['concept/permissions'], notFound: ['concept/nope'], superseded: [] });
    const n = await node('concept/permissions');
    expect(n.lastVerifiedAt).not.toBeNull();
    expect(n.version).toBe(1);
  });

  it('soft-deletes: hidden from reads, kept in the store', async () => {
    await softDelete(ctx, store, ['concept/roles']);
    expect((await node('concept/roles')).status).toBe('deleted');
    expect((await search(ctx, store, { query: 'roles', level: 'title', limit: 10 })).total).toBe(0);
    const [item] = await get(ctx, store, { keys: ['concept/roles'], neighbors: false });
    expect(item?.node).toBeNull();
    expect((await softDelete(ctx, store, ['concept/roles'])).notFound).toEqual(['concept/roles']);
  });

  it('counts each verdict', async () => {
    await feedback(ctx, store, ['concept/roles'], 'useful');
    await feedback(ctx, store, ['concept/roles'], 'outdated_or_wrong');
    await feedback(ctx, store, ['concept/roles'], 'not_useful');
    const n = await node('concept/roles');
    expect([n.usefulCount, n.wrongCount, n.notUsefulCount]).toEqual([1, 1, 1]);
    expect(n.lastUsefulAt).not.toBeNull();
  });

  it('takes feedback on a superseded node, and names the replacement where it cannot act', async () => {
    await supersede(ctx, store, { old: 'concept/roles', new: 'concept/permissions' });
    expect((await feedback(ctx, store, ['concept/roles'], 'outdated_or_wrong')).done).toEqual(['concept/roles']);
    expect((await node('concept/roles')).wrongCount).toBe(1);
    expect(await verify(ctx, store, ['concept/roles'])).toEqual({
      done: [],
      notFound: [],
      superseded: ['concept/roles (now concept/permissions)'],
    });
  });
});

describe('recent and list_types', () => {
  it('lists writes and useful marks, newest first', async () => {
    await new Promise((r) => setTimeout(r, 5));
    await upsert(ctx, store, { key: 'concept/roles', type: 'concept', title: 'Roles v2' });
    let entries = await recent(ctx, store, { limit: 10 });
    expect(entries.map((e) => `${e.kind} ${e.node.key}`)).toEqual([
      'updated concept/roles',
      'created concept/permissions',
    ]);

    await new Promise((r) => setTimeout(r, 5));
    await feedback(ctx, store, ['concept/permissions'], 'useful');
    entries = await recent(ctx, store, { limit: 1 });
    expect(entries.map((e) => `${e.kind} ${e.node.key}`)).toEqual(['useful concept/permissions']);

    expect(await recent(ctx, store, { limit: 10, mine: true })).toHaveLength(2);
    expect(await recent(ctx, store, { limit: 10, since: '2999-01-01' })).toHaveLength(0);
  });

  it('reads spans and dates for since', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(parseSince('3d', now)).toBe('2026-10-04T12:00:00.000Z');
    expect(parseSince('12h', now)).toBe('2026-10-07T00:00:00.000Z');
    expect(parseSince('2026-10-01', now)).toBe('2026-10-01T00:00:00.000Z');
    expect(() => parseSince('last week', now)).toThrow("Can't read since");
  });

  it('lists types with counts and the unused starters', async () => {
    await link(ctx, store, { from: 'concept/roles', to: 'concept/permissions', type: 'part_of' });
    const out = await listTypes(ctx, store);
    expect(out.nodeTypes).toEqual([{ name: 'concept', count: 2 }]);
    expect(out.edgeTypes).toEqual([{ name: 'part_of', count: 1 }]);
    expect(out.unusedNodeStarters).toEqual(['note', 'decision', 'how-to']);
    expect(out.unusedEdgeStarters).not.toContain('part_of');
  });
});
