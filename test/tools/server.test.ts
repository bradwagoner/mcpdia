import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { soloContext } from '../../src/context.js';
import { createServer } from '../../src/server.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';

/** End to end over MCP: the tools as a client sees them. */
describe('MCP server', () => {
  let client: Client;
  let store: SqliteStore;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    const server = createServer(store, soloContext());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
  });

  afterEach(async () => {
    await client.close();
    await store.close();
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content.map((c) => c.text).join('\n'), isError: result.isError === true };
  }

  it('lists the v0.1 tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'annotate',
      'delete',
      'feedback',
      'get',
      'link',
      'list_types',
      'orient',
      'recent',
      'search',
      'supersede',
      'upsert',
      'verify',
    ]);
  });

  it('keeps every tool description short', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) expect(tool.description?.length, tool.name).toBeLessThanOrEqual(160);
  });

  it('writes links with upsert and points out a missing parent', async () => {
    expect(
      (
        await call('upsert', {
          type: 'task',
          title: 'Ship it',
          summary: 'Release v1.',
          links: [{ type: 'part_of', to: 'plan/launch' }],
        })
      ).text,
    ).toBe(
      'Created task/ship-it (v1).\n' +
        'Type "task" is new here. list_types shows the types in use.\n' +
        'Linked: task/ship-it → part_of → plan/launch.\n' +
        'plan/launch does not exist yet; the link resolves when it is created.',
    );
    expect((await call('upsert', { type: 'task', title: 'Loose end', summary: 'Tidy up.' })).text).toBe(
      'Created task/loose-end (v1).\n' +
        'task/loose-end has no parent. Most nodes sit under something, so this is probably not right; link it with part_of unless it starts something new.',
    );
  });

  it('runs the note, feedback and lifecycle tools', async () => {
    await call('upsert', { key: 'concept/permissions', type: 'concept', title: 'Permission system' });
    expect((await call('annotate', { on: 'concept/permissions', text: 'Permissions cache is 5 min' })).text).toBe(
      'Noted note/permissions-cache-is-5-min on concept/permissions.',
    );
    expect((await call('feedback', { keys: ['concept/permissions', 'concept/nope'], verdict: 'useful' })).text).toBe(
      'Marked useful: concept/permissions.\nNot found: concept/nope.',
    );
    expect((await call('verify', { keys: ['concept/permissions'] })).text).toBe('Verified concept/permissions.');
    expect((await call('list_types')).text).toBe(
      'Node types: concept 1, note 1\n' +
        'Edge types: comments_on 1\n' +
        'Also available: decision, how-to, related_to, part_of, depends_on, supersedes, example_of, references',
    );
    const latest = (await call('recent')).text;
    expect(latest).toContain('- concept/permissions [concept] Permission system · marked useful ');
    expect(latest).toContain('- note/permissions-cache-is-5-min [note] Permissions cache is 5 min · created ');

    expect((await call('supersede', { old: 'concept/permissions', title: 'Access model' })).text).toBe(
      'concept/access-model (new) supersedes concept/permissions. Moved 1 link.',
    );
    expect((await call('get', { keys: ['concept/permissions'], level: 'title' })).text).toBe(
      'concept/permissions [concept] Permission system (superseded by concept/access-model)',
    );
    expect((await call('get', { keys: ['concept/permissions'] })).text).toContain('Superseded by concept/access-model');

    expect((await call('delete', { keys: ['concept/access-model'] })).text).toBe('Deleted concept/access-model.');
    expect((await call('search', { query: 'access' })).text).toContain('No results');
  });

  it('runs the write-then-read loop as compact text', async () => {
    expect((await call('orient')).text).toContain('The graph is empty.');

    expect(
      (
        await call('upsert', {
          key: 'concept/permissions',
          type: 'concept',
          title: 'Permission system',
          summary: 'Roles grant actions; groups hold roles.',
          body: 'Effective permissions are the union of roles.',
          tags: ['auth'],
        })
      ).text,
    ).toBe(
      'Created concept/permissions (v1).\n' +
        'concept/permissions has no parent. Most nodes sit under something, so this is probably not right; link it with part_of unless it starts something new.',
    );
    await call('upsert', { key: 'concept/roles', type: 'concept', title: 'Roles' });
    expect((await call('link', { from: 'concept/permissions', to: 'concept/roles', type: 'depends_on' })).text).toBe(
      'Linked: concept/permissions → depends_on → concept/roles.',
    );
    expect(
      (await call('link', { from: 'concept/permissions', to: 'concept/audit-log', type: 'references' })).text,
    ).toBe(
      'Linked: concept/permissions → references → concept/audit-log.\n' +
        'concept/audit-log does not exist yet; the link resolves when it is created.',
    );

    expect((await call('search', { query: 'permission' })).text).toBe(
      '1 result for "permission":\n' +
        '- concept/permissions [concept] Permission system\n' +
        '  Roles grant actions; groups hold roles. · 2 links',
    );
    expect((await call('search', { query: 'permission billing', level: 'title' })).text).toBe(
      'No node matched all words of "permission billing". 1 partial match; check it before relying on it:\n' +
        '- concept/permissions [concept] Permission system (matched: permission)',
    );

    const got = (await call('get', { keys: ['concept/permissions'], neighbors: true })).text;
    expect(got).toMatch(/^concept\/permissions \[concept\] Permission system {3}v1 · updated \d{4}-\d{2}-\d{2}\n/);
    expect(got).toContain('Tags: auth');
    expect(got).toContain('\n\nEffective permissions are the union of roles.');
    expect(got).toContain('Links:\n→ depends_on: concept/roles Roles\n→ references: concept/audit-log (missing)');

    const oriented = (await call('orient', { focus: 'roles' })).text;
    expect(oriented).toContain('Graph: 2 nodes · 1 node type · 2 edge types');
    expect(oriented).toContain('Possibly relevant to "roles":\n- concept/roles [concept] Roles');

    await call('verify', { keys: ['concept/permissions'] });
    expect((await call('search', { query: 'permission' })).text).toMatch(
      /^ {2}Roles grant actions; groups hold roles\. · 2 links · verified \d{4}-\d{2}-\d{2}$/m,
    );
  });

  it('reports problems as one line with the error flag', async () => {
    const missing = await call('get', { keys: ['concept/nope'] });
    expect(missing).toEqual({ text: 'Not found: concept/nope. search finds nodes by their words.', isError: false });

    const bad = await call('link', { from: 'concept/nope', to: 'concept/x', type: 'part_of' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toBe('Not found: concept/nope. Create it with upsert first, or search for its key.');

    expect((await call('search', { query: 'nothing here' })).text).toBe(
      'No results for "nothing here". Try fewer or different words.',
    );
  });
});
