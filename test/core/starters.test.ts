import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configFromEnv, soloContext, type Context } from '../../src/context.js';
import { annotate } from '../../src/core/annotate.js';
import { exportJsonl } from '../../src/core/export.js';
import { get } from '../../src/core/get.js';
import { displayKey } from '../../src/core/keys.js';
import { feedback, softDelete, supersede } from '../../src/core/lifecycle.js';
import { link } from '../../src/core/link.js';
import { renderStub } from '../../src/core/render.js';
import { search } from '../../src/core/search.js';
import { lastLoaded, loadStarter } from '../../src/core/starters.js';
import { upsert } from '../../src/core/upsert.js';
import { loadStarters } from '../../src/starters.js';
import type { GraphStore } from '../../src/store/GraphStore.js';
import type { PgDatabase, Sql } from '../../src/store/postgres/db.js';
import { PostgresStore } from '../../src/store/postgres/PostgresStore.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';

/** Starter sets (ADR 0026) on both stores. */

let lite: PGlite;
beforeAll(async () => {
  lite = await PGlite.create();
});
afterAll(async () => {
  await lite.close();
});

function pglite(db: PGlite): PgDatabase {
  const wrap = (c: Pick<PGlite, 'query' | 'exec'>): Sql => ({
    query: async <R>(text: string, params?: unknown[]) => (await c.query<R>(text, params)).rows,
    exec: async (script) => {
      await c.exec(script);
    },
  });
  return { ...wrap(db), transaction: (fn) => db.transaction((tx) => fn(wrap(tx))), close: async () => {} };
}

const stores: [string, () => Promise<GraphStore>][] = [
  ['sqlite', async () => new SqliteStore(':memory:')],
  [
    'postgres (PGlite)',
    async () => {
      const db = pglite(lite);
      await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      return PostgresStore.open(db);
    },
  ],
];

describe.each(stores)('starter sets: %s', (_, makeStore) => {
  /** The graph the starter set comes from. */
  let source: GraphStore;
  /** The graph that loads it. */
  let store: GraphStore;
  const author = soloContext();
  const ctx: Context = configFromEnv({ MCPDIA_STARTERS: 'mcpdia=unused.jsonl' }).ctx;

  beforeEach(async () => {
    source = new SqliteStore(':memory:');
    store = await makeStore();
    await upsert(author, source, { type: 'concept', title: 'MCPdia', summary: 'Memory for LLMs.', tags: ['starter'] });
    await upsert(author, source, {
      type: 'concept',
      title: 'Stubs first',
      summary: 'Search returns one line per node.',
      tags: ['starter'],
      links: [{ type: 'part_of', to: 'concept/mcpdia' }],
    });
    await upsert(author, source, {
      type: 'plan',
      title: 'Private plan',
      links: [{ type: 'references', to: 'concept/mcpdia' }],
    });
  });

  afterEach(async () => {
    await source.close();
    await store.close();
  });

  async function exported(tags = ['starter']): Promise<string> {
    const lines: string[] = [];
    await exportJsonl(author, source, { tags }, (line) => {
      lines.push(line);
    });
    return lines.join('\n') + '\n';
  }

  it('loads nodes and links into the starter namespace, stamped with their source', async () => {
    const result = await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    expect(result).toMatchObject({ nodes: 2, created: 2, updated: 0, deleted: 0, edgesAdded: 1, unchanged: false });

    const node = await store.getNode('mcpdia', 'concept/stubs-first');
    expect(node).toMatchObject({ source: 'starter:mcpdia', summary: 'Search returns one line per node.' });
    const [edge] = await store.listEdges(['mcpdia']);
    expect(edge).toMatchObject({ toNamespace: 'mcpdia', toKey: 'concept/mcpdia' });
    expect(edge!.toId).not.toBeNull();
    // The untagged private plan stayed out.
    expect(await store.getNode('mcpdia', 'plan/private-plan')).toBeNull();
  });

  it('skips a source that has not changed, even when exported again later', async () => {
    await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    const again = await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    expect(again).toMatchObject({ unchanged: true, created: 0 });
    expect((await store.getNode('mcpdia', 'concept/mcpdia'))!.version).toBe(1);
  });

  it('updates changed nodes, marks removed ones deleted and drops their links', async () => {
    await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    await upsert(author, source, {
      key: 'concept/mcpdia',
      type: 'concept',
      title: 'MCPdia',
      summary: 'Long-term memory.',
    });
    await softDelete(author, source, ['concept/stubs-first']);

    const result = await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    expect(result).toMatchObject({ nodes: 1, created: 0, updated: 1, deleted: 1, edgesRemoved: 1 });
    const updated = (await store.getNode('mcpdia', 'concept/mcpdia'))!;
    expect([updated.summary, updated.version, updated.updatedBy]).toEqual(['Long-term memory.', 2, 'starter:mcpdia']);
    expect((await store.getNode('mcpdia', 'concept/stubs-first'))!.status).toBe('deleted');
    expect(await store.listEdges(['mcpdia'])).toEqual([]);
  });

  it('brings back a node that returns to the source', async () => {
    await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    const full = await exported();
    await loadStarter(
      store,
      'mcpdia',
      'set.jsonl',
      full
        .split('\n')
        .filter((l) => !l.includes('stubs-first'))
        .join('\n'),
    );
    await loadStarter(store, 'mcpdia', 'set.jsonl', full);
    const node = (await store.getNode('mcpdia', 'concept/stubs-first'))!;
    expect(node.status).toBe('active');
  });

  it('carries superseded nodes over, pointing at their replacement', async () => {
    await upsert(author, source, { type: 'concept', title: 'Render levels', tags: ['starter'] });
    await supersede(author, source, { old: 'concept/stubs-first', new: 'concept/render-levels' });
    const lines: string[] = [];
    await exportJsonl(author, source, { tags: ['starter'], allStatus: true }, (l) => {
      lines.push(l);
    });
    await loadStarter(store, 'mcpdia', 'set.jsonl', lines.join('\n'));
    const old = (await store.getNode('mcpdia', 'concept/stubs-first'))!;
    const replacement = (await store.getNode('mcpdia', 'concept/render-levels'))!;
    expect([old.status, old.supersededBy]).toEqual(['superseded', replacement.id]);
  });

  it('resolves your links to starter keys once the set loads', async () => {
    await upsert(ctx, store, {
      type: 'note',
      title: 'My take',
      links: [{ type: 'references', to: 'mcpdia:concept/mcpdia' }],
    });
    await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    const [item] = await get(ctx, store, { keys: ['note/my-take'], neighbors: true });
    expect(item?.node && 'neighbors' in item ? item.neighbors : []).toEqual([
      expect.objectContaining({ key: 'mcpdia:concept/mcpdia', node: expect.objectContaining({ title: 'MCPdia' }) }),
    ]);
  });

  it('refuses text that is not an mcpdia export, or from a newer version', async () => {
    await expect(loadStarter(store, 'mcpdia', 'x', '{"kind":"node"}\n')).rejects.toThrow('Not an mcpdia export');
    await expect(loadStarter(store, 'mcpdia', 'x', 'not json\n')).rejects.toThrow('Line 1 is not JSON.');
    const future = JSON.stringify({ kind: 'header', format: 'mcpdia-jsonl', version: 99, namespaces: ['default'] });
    await expect(loadStarter(store, 'mcpdia', 'x', future)).rejects.toThrow('newer than this MCPdia reads');
    expect(await lastLoaded(store, 'mcpdia')).toBeUndefined();
  });

  describe('reading next to your own graph', () => {
    beforeEach(async () => {
      await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
      await upsert(ctx, store, { type: 'concept', title: 'My stubs', summary: 'Stubs in my words.' });
    });

    it('searches both, showing your keys bare and starter keys qualified', async () => {
      const out = await search(ctx, store, { query: 'stubs', level: 'summary', limit: 10 });
      expect(out.hits.map((h) => displayKey(ctx, h.node.namespace, h.node.key)).sort()).toEqual([
        'concept/my-stubs',
        'mcpdia:concept/stubs-first',
      ]);
    });

    it('lets you edit, supersede and link from starter nodes like any other', async () => {
      await upsert(ctx, store, { key: 'mcpdia:concept/mcpdia', type: 'concept', title: 'MCPdia', summary: 'Mine.' });
      await link(ctx, store, { from: 'mcpdia:concept/mcpdia', to: 'concept/my-stubs', type: 'related_to' });
      await supersede(ctx, store, { old: 'mcpdia:concept/stubs-first', new: 'concept/my-stubs' });
      expect((await store.getNode('mcpdia', 'concept/mcpdia'))!.summary).toBe('Mine.');
      expect((await store.getNode('mcpdia', 'concept/stubs-first'))!.status).toBe('superseded');
    });

    it('lets you annotate them, link to them and mark them useful', async () => {
      await annotate(ctx, store, { on: 'mcpdia:concept/stubs-first', text: 'Works well with get.' });
      const out = await link(ctx, store, {
        from: 'concept/my-stubs',
        to: 'mcpdia:concept/stubs-first',
        type: 'related_to',
      });
      expect(out.toKey).toBe('mcpdia:concept/stubs-first');
      await feedback(ctx, store, ['mcpdia:concept/stubs-first'], 'useful');
      expect((await store.getNode('mcpdia', 'concept/stubs-first'))!.usefulCount).toBe(1);
    });
  });

  describe('reconciling a reload with your edits', () => {
    const reload = async () => loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
    const upstream = (summary: string) =>
      upsert(author, source, { key: 'concept/stubs-first', type: 'concept', title: 'Stubs first', summary });
    const mine = (summary: string) =>
      upsert(ctx, store, { key: 'mcpdia:concept/stubs-first', type: 'concept', title: 'Stubs first', summary });
    /** An upstream change elsewhere, so the source text differs but this node doesn't. */
    let n = 0;
    const elsewhere = () =>
      upsert(author, source, { key: 'concept/mcpdia', type: 'concept', title: 'MCPdia', summary: `v${++n}` });

    beforeEach(async () => {
      await reload();
    });

    it('keeps your edit when the source left that node alone', async () => {
      await mine('My words.');
      await elsewhere();
      expect(await reload()).toMatchObject({ kept: 1, updated: 1, conflicts: [] });
      expect((await store.getNode('mcpdia', 'concept/stubs-first'))!.summary).toBe('My words.');
    });

    it('takes a matching change quietly', async () => {
      await mine('Same words.');
      await upstream('Same words.');
      expect(await reload()).toMatchObject({ updated: 0, conflicts: [] });
    });

    it('writes one conflict node when both sides changed, and shows it on get and search', async () => {
      await mine('My words.');
      await upstream('Their words.');
      const result = await reload();
      expect(result.conflicts).toEqual([
        { key: 'conflict/concept/stubs-first', nodeKey: 'concept/stubs-first', state: 'new' },
      ]);
      const node = (await store.getNode('mcpdia', 'concept/stubs-first'))!;
      expect(node.summary).toBe('My words.');
      const conflict = (await store.getNode('mcpdia', 'conflict/concept/stubs-first'))!;
      expect(conflict).toMatchObject({ type: 'conflict', status: 'active' });
      expect(conflict.body).toContain('Incoming summary: Their words.');

      const [item] = await get(ctx, store, { keys: ['mcpdia:concept/stubs-first'], neighbors: false });
      expect(item && 'conflictKey' in item ? item.conflictKey : undefined).toBe('mcpdia:conflict/concept/stubs-first');
      const out = await search(ctx, store, { query: 'stubs', level: 'title', limit: 10 });
      expect(out.hits.find((h) => h.node.key === 'concept/stubs-first')?.conflictKey).toBe(
        'mcpdia:conflict/concept/stubs-first',
      );
      expect(renderStub(ctx, node, 'title', { conflictKey: 'mcpdia:conflict/concept/stubs-first' })).toBe(
        'mcpdia:concept/stubs-first [concept] Stubs first (newer version in mcpdia:conflict/concept/stubs-first)',
      );
      // Only your own namespace in view: no lookup, no marker.
      const [solo] = await get(soloContext(), source, { keys: ['concept/stubs-first'], neighbors: false });
      expect(solo && 'conflictKey' in solo ? solo.conflictKey : undefined).toBeUndefined();
    });

    it('updates the same conflict in place when the source changes again before you look', async () => {
      await mine('My words.');
      await upstream('Their words.');
      await reload();
      await upstream('Their newer words.');
      expect((await reload()).conflicts).toEqual([expect.objectContaining({ state: 'updated' })]);
      const conflict = (await store.getNode('mcpdia', 'conflict/concept/stubs-first'))!;
      expect([conflict.version, conflict.status]).toEqual([2, 'active']);
      expect(conflict.body).toContain('Their newer words.');
    });

    it('keeps a resolved conflict resolved until the source changes that node again', async () => {
      await mine('My words.');
      await upstream('Their words.');
      await reload();
      await softDelete(ctx, store, ['mcpdia:conflict/concept/stubs-first']);

      await elsewhere();
      expect((await reload()).conflicts).toEqual([]);
      await elsewhere();
      expect((await reload()).conflicts).toEqual([]);

      await upstream('Their newer words.');
      expect((await reload()).conflicts).toEqual([expect.objectContaining({ state: 'reopened' })]);
      expect((await store.getNode('mcpdia', 'conflict/concept/stubs-first'))!.status).toBe('active');
    });

    it('lists open conflicts even when the source has not changed', async () => {
      await mine('My words.');
      await upstream('Their words.');
      await reload();
      expect(await reload()).toMatchObject({
        unchanged: true,
        conflicts: [expect.objectContaining({ state: 'open' })],
      });
    });

    it('keeps a node you edited when the source removes it, and flags it', async () => {
      await mine('My words.');
      await softDelete(author, source, ['concept/stubs-first']);
      const result = await reload();
      expect(result).toMatchObject({ deleted: 0, conflicts: [expect.objectContaining({ state: 'new' })] });
      expect((await store.getNode('mcpdia', 'concept/stubs-first'))!.status).toBe('active');
      expect((await store.getNode('mcpdia', 'conflict/concept/stubs-first'))!.body).toBe('Removed upstream.');
    });

    it('removes only the links the set wrote', async () => {
      await upsert(ctx, store, { type: 'concept', title: 'Mine' });
      await link(ctx, store, { from: 'mcpdia:concept/mcpdia', to: 'concept/mine', type: 'related_to' });
      await softDelete(author, source, ['concept/stubs-first']);
      const result = await reload();
      expect(result.edgesRemoved).toBe(1);
      expect((await store.listEdges(['mcpdia'])).map((e) => e.type)).toEqual(['related_to']);
    });
  });

  describe('edge cases', () => {
    it('leaves alone nodes you add to the starter namespace yourself', async () => {
      await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
      await upsert(ctx, store, { key: 'mcpdia:concept/mine', type: 'concept', title: 'Mine' });
      await upsert(author, source, { key: 'concept/mcpdia', type: 'concept', title: 'MCPdia', summary: 'Changed.' });
      const result = await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
      expect(result).toMatchObject({ deleted: 0, conflicts: [] });
      expect((await store.getNode('mcpdia', 'concept/mine'))!.status).toBe('active');
    });

    it('refuses to load into a namespace that already holds other nodes', async () => {
      await upsert(ctx, store, { key: 'mcpdia:concept/mine', type: 'concept', title: 'Mine' });
      await expect(loadStarter(store, 'mcpdia', 'set.jsonl', await exported())).rejects.toThrow(
        "already has nodes that didn't come from a starter set",
      );
    });

    it('stays stable on unsorted tags, aliases and nested properties', async () => {
      await upsert(author, source, {
        key: 'concept/mcpdia',
        type: 'concept',
        title: 'MCPdia',
        tags: ['zeta', 'starter', 'alpha'],
        aliases: ['Zed', 'ay'],
        properties: { b: 1, a: { y: 2, x: 1 } },
      });
      await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
      await upsert(author, source, {
        key: 'concept/stubs-first',
        type: 'concept',
        title: 'Stubs first',
        summary: 'New.',
      });
      const result = await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
      expect(result).toMatchObject({ updated: 1, kept: 0, conflicts: [] });
    });

    it('asks again when a node you edited is removed a second time', async () => {
      const full = await exported();
      const without = full
        .split('\n')
        .filter((l) => !l.includes('stubs-first'))
        .join('\n');
      await loadStarter(store, 'mcpdia', 'set.jsonl', full);
      await upsert(ctx, store, {
        key: 'mcpdia:concept/stubs-first',
        type: 'concept',
        title: 'Stubs first',
        summary: 'Mine.',
      });
      await loadStarter(store, 'mcpdia', 'set.jsonl', without);
      await softDelete(ctx, store, ['mcpdia:conflict/concept/stubs-first']);
      await upsert(author, source, {
        key: 'concept/stubs-first',
        type: 'concept',
        title: 'Stubs first',
        summary: 'Back.',
      });
      await loadStarter(store, 'mcpdia', 'set.jsonl', await exported());
      await softDelete(ctx, store, ['mcpdia:conflict/concept/stubs-first']);
      const again = await loadStarter(store, 'mcpdia', 'set.jsonl', without);
      expect(again.conflicts).toEqual([expect.objectContaining({ state: 'reopened' })]);
    });

    it('refuses an export with the same key twice', async () => {
      const lines = (await exported()).trim().split('\n');
      await expect(loadStarter(store, 'mcpdia', 'x', [...lines, lines[1]].join('\n'))).rejects.toThrow(
        'The export has concept/mcpdia twice',
      );
    });

    it('reads files with a UTF-8 byte-order mark, or written as UTF-16', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcpdia-starter-'));
      const text = await exported();
      writeFileSync(join(dir, 'bom.jsonl'), '﻿' + text);
      writeFileSync(join(dir, 'utf16.jsonl'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
      const lines: string[] = [];
      await loadStarters(
        store,
        [
          { name: 'bom', source: 'bom.jsonl' },
          { name: 'wide', source: 'utf16.jsonl' },
        ],
        dir,
        (l) => lines.push(l),
      );
      expect(lines).toEqual([
        'starter bom: 2 nodes (2 new, links +1 -0)',
        'starter wide: 2 nodes (2 new, links +1 -0)',
      ]);
    });
  });

  it('starts without a source it cannot read, keeping the copy loaded before', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpdia-starter-'));
    const file = join(dir, 'set.jsonl');
    writeFileSync(file, await exported());
    const lines: string[] = [];
    await loadStarters(store, [{ name: 'mcpdia', source: 'set.jsonl' }], dir, (l) => lines.push(l));
    await loadStarters(store, [{ name: 'mcpdia', source: join(dir, 'gone.jsonl') }], dir, (l) => lines.push(l));
    await loadStarters(store, [{ name: 'other', source: join(dir, 'gone.jsonl') }], dir, (l) => lines.push(l));
    expect(lines[0]).toBe('starter mcpdia: 2 nodes (2 new, links +1 -0)');
    expect(lines[1]).toMatch(/^starter mcpdia: could not load .*gone\.jsonl \(.*\); using the copy loaded \d{4}-/);
    expect(lines[2]).toMatch(/^starter other: could not load .*; starting without it$/);
    expect((await store.getNode('mcpdia', 'concept/mcpdia'))!.status).toBe('active');
  });
});

describe('configFromEnv', () => {
  it('reads only the default namespace when nothing is set', () => {
    expect(configFromEnv({})).toEqual({ ctx: soloContext(), starters: [] });
  });

  it('adds read namespaces and read-only starter sets, and picks the write namespace', () => {
    const { ctx, starters } = configFromEnv({
      MCPDIA_WRITE_NAMESPACE: 'mine',
      MCPDIA_NAMESPACES: 'team, mine',
      MCPDIA_STARTERS: 'mcpdia=./starters/mcpdia.jsonl, team-kb=http://localhost:7411/export?tag=a=b',
    });
    expect(ctx).toEqual({ caller: 'local', namespaces: ['mine', 'team', 'mcpdia', 'team-kb'], writeNamespace: 'mine' });
    expect(starters).toEqual([
      { name: 'mcpdia', source: './starters/mcpdia.jsonl' },
      { name: 'team-kb', source: 'http://localhost:7411/export?tag=a=b' },
    ]);
  });

  it('refuses a starter set named like the write namespace, a repeated name, or a bad entry', () => {
    expect(() => configFromEnv({ MCPDIA_STARTERS: 'default=x.jsonl' })).toThrow('also the write namespace');
    expect(() => configFromEnv({ MCPDIA_STARTERS: 'a=x.jsonl,a=y.jsonl' })).toThrow('names "a" twice');
    expect(() => configFromEnv({ MCPDIA_STARTERS: 'x.jsonl' })).toThrow('is not name=source');
    expect(() => configFromEnv({ MCPDIA_STARTERS: 'a:b=x.jsonl' })).toThrow('is not a namespace name');
  });
});
