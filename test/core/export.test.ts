import { beforeEach, describe, expect, it } from 'vitest';
import { soloContext } from '../../src/context.js';
import { UserError } from '../../src/core/errors.js';
import { exportJsonl, type ExportLine } from '../../src/core/export.js';
import { supersede } from '../../src/core/lifecycle.js';
import { link } from '../../src/core/link.js';
import { upsert } from '../../src/core/upsert.js';
import type { GraphStore } from '../../src/store/GraphStore.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';

const ctx = soloContext();
let store: GraphStore;

beforeEach(() => {
  store = new SqliteStore(':memory:');
});

async function exported(namespaces?: string[]): Promise<ExportLine[]> {
  const lines: string[] = [];
  await exportJsonl(ctx, store, { namespaces }, (line) => {
    lines.push(line);
  });
  return lines.map((l) => JSON.parse(l) as ExportLine);
}

describe('exportJsonl', () => {
  it('writes a header, then active nodes, then edges, one JSON object per line', async () => {
    await upsert(ctx, store, { type: 'concept', title: 'Permissions', summary: 'Roles grant actions.' });
    await upsert(ctx, store, { type: 'concept', title: 'Roles' });
    await upsert(ctx, store, { type: 'concept', title: 'Access' });
    await link(ctx, store, { from: 'concept/permissions', to: 'concept/roles', type: 'depends_on' });
    await supersede(ctx, store, { old: 'concept/permissions', new: 'concept/access' });

    const lines = await exported();
    expect(lines[0]).toMatchObject({
      kind: 'header',
      format: 'mcpdia-jsonl',
      version: 1,
      statuses: ['active'],
      nodes: 2,
    });
    // supersede adds its own edge alongside the depends_on link it moved.
    expect(lines.map((l) => l.kind)).toEqual(['header', 'node', 'node', 'edge', 'edge']);
    expect(lines.some((l) => l.kind === 'node' && l.key === 'concept/permissions')).toBe(false);
    expect(lines).toContainEqual(expect.objectContaining({ kind: 'edge', type: 'depends_on', toKey: 'concept/roles' }));
  });

  it('includes superseded and deleted nodes with allStatus', async () => {
    await upsert(ctx, store, { type: 'concept', title: 'Permissions', summary: 'Roles grant actions.' });
    await upsert(ctx, store, { type: 'concept', title: 'Access' });
    await supersede(ctx, store, { old: 'concept/permissions', new: 'concept/access' });

    const lines: ExportLine[] = [];
    await exportJsonl(ctx, store, { allStatus: true }, (line) => {
      lines.push(JSON.parse(line) as ExportLine);
    });
    expect(lines[0]).toMatchObject({ statuses: ['active', 'superseded', 'deleted'], nodes: 2 });
    const perms = lines.find((l) => l.kind === 'node' && l.key === 'concept/permissions');
    expect(perms).toMatchObject({ status: 'superseded', summary: 'Roles grant actions.' });
  });

  it('keeps only tagged nodes and the links between them with tags', async () => {
    await upsert(ctx, store, { type: 'concept', title: 'Public', tags: ['Starter'] });
    await upsert(ctx, store, {
      type: 'concept',
      title: 'Also public',
      tags: ['starter'],
      links: [{ type: 'part_of', to: 'concept/public' }],
    });
    await upsert(ctx, store, { type: 'plan', title: 'Private', links: [{ type: 'references', to: 'concept/public' }] });

    const lines: ExportLine[] = [];
    await exportJsonl(ctx, store, { tags: ['STARTER'] }, (line) => {
      lines.push(JSON.parse(line) as ExportLine);
    });
    expect(lines[0]).toMatchObject({ kind: 'header', tags: ['starter'], nodes: 2, edges: 1 });
    expect(lines.filter((l) => l.kind === 'node').map((l) => (l.kind === 'node' ? l.key : ''))).toEqual([
      'concept/public',
      'concept/also-public',
    ]);
    expect(lines.filter((l) => l.kind === 'edge')).toEqual([
      expect.objectContaining({ fromKey: 'concept/also-public', type: 'part_of' }),
    ]);
  });

  it('exports only the write namespace unless others are named', async () => {
    const both = { ...ctx, namespaces: ['default', 'mcpdia'] };
    await upsert(ctx, store, { type: 'concept', title: 'Mine' });
    await upsert(both, store, { key: 'mcpdia:concept/theirs', type: 'concept', title: 'Theirs' });
    const keys = async (namespaces?: string[]) => {
      const lines: ExportLine[] = [];
      await exportJsonl(both, store, { namespaces }, (line) => {
        lines.push(JSON.parse(line) as ExportLine);
      });
      return lines.map((l) => (l.kind === 'node' ? `${l.namespace}:${l.key}` : l.kind));
    };
    expect(await keys()).toEqual(['header', 'default:concept/mine']);
    expect(await keys(['default', 'mcpdia'])).toEqual(['header', 'default:concept/mine', 'mcpdia:concept/theirs']);
  });

  it('refuses a namespace the caller cannot read', async () => {
    const err = await exported(['secret']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
  });
});
