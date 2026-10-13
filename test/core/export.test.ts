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
  it('writes a header, then nodes of any status, then edges, one JSON object per line', async () => {
    await upsert(ctx, store, { type: 'concept', title: 'Permissions', summary: 'Roles grant actions.' });
    await upsert(ctx, store, { type: 'concept', title: 'Roles' });
    await upsert(ctx, store, { type: 'concept', title: 'Access' });
    await link(ctx, store, { from: 'concept/permissions', to: 'concept/roles', type: 'depends_on' });
    await supersede(ctx, store, { old: 'concept/permissions', new: 'concept/access' });

    const lines = await exported();
    expect(lines[0]).toMatchObject({ kind: 'header', format: 'mcpedia-jsonl', version: 1, nodes: 3 });
    // supersede adds its own edge alongside the depends_on link.
    expect(lines.map((l) => l.kind)).toEqual(['header', 'node', 'node', 'node', 'edge', 'edge']);
    const perms = lines.find((l) => l.kind === 'node' && l.key === 'concept/permissions');
    expect(perms).toMatchObject({ status: 'superseded', summary: 'Roles grant actions.' });
    expect(lines).toContainEqual(expect.objectContaining({ kind: 'edge', type: 'depends_on', toKey: 'concept/roles' }));
  });

  it('refuses a namespace the caller cannot read', async () => {
    const err = await exported(['secret']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
  });
});
