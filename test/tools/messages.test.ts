import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { soloContext } from '../../src/context.js';
import { createServer } from '../../src/server.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';

/** The one-line messages tools add when they know something the caller would want (ADR 0016). */
describe('tool messages', () => {
  let client: Client;
  let store: SqliteStore;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    const server = createServer(store, soloContext());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    await call('upsert', {
      key: 'concept/permissions',
      type: 'concept',
      title: 'Permission system',
      summary: 'Roles.',
    });
    await call('upsert', { key: 'concept/roles', type: 'concept', title: 'Roles' });
  });

  afterEach(async () => {
    await client.close();
    await store.close();
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return content.map((c) => c.text).join('\n');
  }

  it('flags a node marked outdated or wrong until it is edited or verified', async () => {
    await call('feedback', { keys: ['concept/permissions'], verdict: 'outdated_or_wrong' });
    expect(await call('search', { query: 'permission', level: 'title' })).toContain(
      'concept/permissions [concept] Permission system (flagged outdated or wrong)',
    );
    expect(await call('get', { keys: ['concept/permissions'] })).toMatch(
      /\nFlagged outdated or wrong on \d{4}-\d{2}-\d{2}\. Check it before relying on it; fix it with upsert, or verify it if it is still right\.\n/,
    );

    await call('verify', { keys: ['concept/permissions'] });
    expect(await call('get', { keys: ['concept/permissions'] })).not.toContain('Flagged');

    await call('feedback', { keys: ['concept/permissions'], verdict: 'outdated_or_wrong' });
    await call('upsert', { key: 'concept/permissions', type: 'concept', title: 'Permission system' });
    expect(await call('get', { keys: ['concept/permissions'] })).not.toContain('Flagged');
  });

  it('says a node was deleted instead of not found', async () => {
    await call('delete', { keys: ['concept/roles'] });
    expect(await call('get', { keys: ['concept/roles'] })).toMatch(
      /^concept\/roles was deleted; all_status: true shows it\./,
    );
    expect(await call('verify', { keys: ['concept/roles', 'concept/nope'] })).toBe(
      'Not found: concept/nope.\nAlready deleted: concept/roles.',
    );
    expect(await call('annotate', { on: 'concept/roles', text: 'Hi' })).toBe(
      'concept/roles was deleted. Upsert its key to restore it, or search for a current node.',
    );
  });

  it('reads deleted and superseded nodes on request', async () => {
    await call('upsert', { key: 'concept/old', type: 'concept', title: 'Old roles', summary: 'x' });
    await call('supersede', { old: 'concept/old', new: 'concept/permissions' });
    await call('delete', { keys: ['concept/roles'] });
    expect(await call('search', { query: 'roles', level: 'title' })).toBe(
      '1 result for "roles":\n- concept/permissions [concept] Permission system',
    );
    const all = await call('search', { query: 'roles', level: 'title', all_status: true });
    expect(all).toContain('concept/roles [concept] Roles (deleted)');
    expect(all).toContain('concept/old [concept] Old roles (superseded by concept/permissions)');
    expect(await call('get', { keys: ['concept/roles'], all_status: true })).toMatch(
      /\nDeleted on \d{4}-\d{2}-\d{2}\. Upsert this key to restore it\./,
    );
  });

  it('restores a deleted node when its key is written again', async () => {
    await call('upsert', { key: 'concept/permissions', type: 'task', title: 'Permission system' });
    await call('upsert', { key: 'concept/roles', type: 'test', title: 'Roles', body: 'Old body.' });
    await call('delete', { keys: ['concept/roles'] });
    expect(await call('upsert', { key: 'concept/roles', type: 'test', title: 'Roles', version: 1 })).toBe(
      'concept/roles changed: it is at v3, not v1. get it again and re-apply your change.',
    );
    expect(await call('get', { keys: ['concept/roles'] })).toMatch(/^concept\/roles was deleted/);
    // No "did you mean task": the node already had type test.
    expect(await call('upsert', { key: 'concept/roles', type: 'test', title: 'Roles again' })).toBe(
      'Restored concept/roles (v5).\nIt was deleted; fields you did not pass kept their old values.',
    );
    const back = await call('get', { keys: ['concept/roles'] });
    expect(back).toContain('Roles again');
    expect(back).toContain('Old body.');
    expect(back).not.toContain('Deleted on');
  });

  it('lists what still links to a deleted node, leaving notes out', async () => {
    await call('link', { from: 'concept/permissions', to: 'concept/roles', type: 'depends_on' });
    await call('annotate', { on: 'concept/roles', text: 'A note' });
    expect(await call('delete', { keys: ['concept/roles'] })).toBe(
      'Deleted concept/roles.\n' +
        'concept/permissions (depends_on) still link to concept/roles, so those links lead nowhere now. ' +
        'Relink them if they need a new target.',
    );
  });

  it('names an unknown type filter and echoes filters on a miss', async () => {
    expect(await call('search', { query: 'roles', type: 'conept' })).toBe(
      'No nodes have type "conept". list_types shows the types in use.',
    );
    expect(await call('search', { query: 'roles', type: 'concept', tag: 'auth' })).toBe(
      'No results for "roles" with type concept and tag auth. Try without the filter, or other words.',
    );
  });

  it('does not call a type unknown when all_status searches the nodes that have it', async () => {
    await call('upsert', { key: 'task/old', type: 'task', title: 'Old task' });
    await call('delete', { keys: ['task/old'] });
    expect(await call('search', { query: 'zebra', type: 'task', all_status: true })).not.toMatch(/^No nodes have type/);
    expect(await call('search', { query: 'zebra', type: 'nope', all_status: true })).not.toMatch(/^No nodes have type/);
  });

  it('shows which words each partial match matched', async () => {
    expect(await call('search', { query: 'permission roles billing', level: 'title' })).toBe(
      'No node matched all words of "permission roles billing". 2 partial matches; check them before relying on them:\n' +
        '- concept/permissions [concept] Permission system (matched: permission, roles)\n' +
        '- concept/roles [concept] Roles (matched: roles)',
    );
    expect(await call('search', { query: 'permission roles billing', level: 'full' })).toContain(
      '\nMatched: permission, roles\n',
    );
  });

  it('lists partial matches after a short list of full matches', async () => {
    await call('upsert', { key: 'concept/billing-roles', type: 'concept', title: 'Billing roles' });
    expect(await call('search', { query: 'billing roles', level: 'title' })).toBe(
      '1 result for "billing roles", then 2 partial matches; check them before relying on them:\n' +
        '- concept/billing-roles [concept] Billing roles\n' +
        '- concept/roles [concept] Roles (matched: roles)\n' +
        '- concept/permissions [concept] Permission system (matched: roles)',
    );
  });

  it('says what an empty recent was filtered by', async () => {
    expect(await call('recent', { since: '2999-01-01', mine: true })).toBe(
      'Nothing recent (since 2999-01-01, yours only).',
    );
  });

  it('warns when a link points at a deleted or superseded node, or closes a loop', async () => {
    await call('upsert', { key: 'concept/old', type: 'concept', title: 'Old', summary: 'x' });
    await call('delete', { keys: ['concept/old'] });
    expect(await call('link', { from: 'concept/roles', to: 'concept/old', type: 'references' })).toBe(
      'Linked: concept/roles → references → concept/old.\n' +
        'concept/old was deleted, so this link leads nowhere. Link to a current node instead.',
    );
    await call('supersede', { old: 'concept/roles', new: 'concept/permissions' });
    expect(await call('link', { from: 'concept/permissions', to: 'concept/roles', type: 'related_to' })).toContain(
      'concept/roles is superseded by concept/permissions. Link to concept/permissions if you meant the current one.',
    );
    await call('upsert', { key: 'plan/a', type: 'plan', title: 'A', summary: 'x' });
    await call('upsert', {
      key: 'plan/b',
      type: 'plan',
      title: 'B',
      summary: 'x',
      links: [{ type: 'part_of', to: 'plan/a' }],
    });
    expect(await call('link', { from: 'plan/a', to: 'plan/b', type: 'part_of' })).toContain(
      'This makes a loop: plan/b already sits under plan/a.',
    );
    expect(await call('link', { from: 'plan/a', to: 'plan/a', type: 'part_of' })).toContain(
      'This makes a loop: plan/a would sit under itself.',
    );
    expect(await call('link', { from: 'concept/deleted-one', to: 'plan/a', type: 'part_of' })).toContain('Not found');
  });

  it('says when a new node has no summary, and which properties an update dropped', async () => {
    expect(
      await call('upsert', { type: 'concept', title: 'Bare', links: [{ type: 'part_of', to: 'plan/x' }] }),
    ).toContain('No summary: search shows only the title, so add a one-line summary if you can.');
    await call('upsert', {
      key: 'concept/roles',
      type: 'concept',
      title: 'Roles',
      properties: { status: 'open', order: 1, owner: 'me' },
    });
    expect(
      await call('upsert', { key: 'concept/roles', type: 'concept', title: 'Roles', properties: { owner: 'me' } }),
    ).toBe(
      'Updated concept/roles (v3).\nProperties replaced; dropped status, order. Pass every property you want to keep.',
    );
  });

  it('points out lookalike types', async () => {
    await call('upsert', { type: 'concepts', title: 'Billing' });
    expect(await call('list_types')).toContain('Look alike: concept and concepts. Pick one and reuse it.');
  });
});
