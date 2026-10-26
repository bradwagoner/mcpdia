import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { soloContext } from '../src/context.js';
import { exportJsonl } from '../src/core/export.js';
import { serveHttp } from '../src/http.js';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite/SqliteStore.js';

/** The HTTP transport end to end: real sockets, a real MCP client. */
describe('HTTP server', () => {
  let store: SqliteStore;
  let http: Server;
  let base: string;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    http = await serveHttp(() => createServer(store, soloContext()), {
      host: '127.0.0.1',
      port: 0,
      allowedHosts: ['graph.internal'],
      exportGraph: (query, write) =>
        exportJsonl(soloContext(), store, { namespaces: query.getAll('namespace'), tags: query.getAll('tag') }, write),
    });
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((done) => http.close(done));
    await store.close();
  });

  async function connect(): Promise<Client> {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    return client;
  }

  it('serves the tools, and clients share one graph', async () => {
    const writer = await connect();
    await writer.callTool({ name: 'upsert', arguments: { type: 'note', title: 'Shared over HTTP' } });
    const reader = await connect();
    const result = await reader.callTool({ name: 'search', arguments: { query: 'shared' } });
    expect((result.content as { text: string }[])[0]!.text).toContain('Shared over HTTP');
    await writer.close();
    await reader.close();
  });

  it('answers health checks', async () => {
    const res = await fetch(`${base}/health`);
    expect([res.status, await res.text()]).toEqual([200, 'ok\n']);
  });

  it('refuses requests addressed to other host names', async () => {
    // fetch won't let a caller set Host, so use a raw request.
    const status = (host: string) =>
      new Promise<number>((resolve, reject) => {
        request(`${base}/health`, { headers: { host } }, (res) => resolve(res.statusCode!))
          .on('error', reject)
          .end();
      });
    expect(await status('evil.example:7411')).toBe(403);
    expect(await status('graph.internal:7411')).toBe(200);
    expect(await status('localhost')).toBe(200);
  });

  it('serves the graph as mcpdia-jsonl at /export, filtered by tag', async () => {
    const client = await connect();
    await client.callTool({ name: 'upsert', arguments: { type: 'note', title: 'Shared', tags: ['starter'] } });
    await client.callTool({ name: 'upsert', arguments: { type: 'note', title: 'Kept back' } });
    await client.close();

    const res = await fetch(`${base}/export?tag=starter`);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { kind: string; key?: string });
    expect(lines.map((l) => l.key ?? l.kind)).toEqual(['header', 'note/shared']);

    const bad = await fetch(`${base}/export?namespace=secret`);
    expect([bad.status, await bad.text()]).toEqual([400, 'Unknown namespace: secret. readable: default\n']);
  });

  it('only serves MCP at /mcp, over POST', async () => {
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
});
