import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { soloContext } from '../../src/context.js';
import { openMetricsLog, type MetricsLog, type ToolCallRecord } from '../../src/metrics.js';
import { createServer } from '../../src/server.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';

describe('metrics log (ADR 0019)', () => {
  let dir: string;
  let store: SqliteStore;
  let client: Client;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcpdia-metrics-'));
    store = new SqliteStore(':memory:');
  });

  afterEach(async () => {
    await client.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function connect(metrics?: MetricsLog) {
    const server = createServer(store, soloContext(), { metrics });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
  }

  function lines(file: string): ToolCallRecord[] {
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as ToolCallRecord);
  }

  it('writes one line per tool call with raw sizes and timing', async () => {
    const log = openMetricsLog(join(dir, 'mcpdia-metrics.jsonl'));
    await connect(log);
    await client.callTool({ name: 'upsert', arguments: { type: 'concept', title: 'Permissions' } });
    const result = await client.callTool({ name: 'search', arguments: { query: 'permissions', level: 'title' } });
    await client.callTool({ name: 'list_types', arguments: {} });
    // A stale version is a UserError, so the call comes back flagged as an error.
    await client.callTool({
      name: 'upsert',
      arguments: { key: 'concept/permissions', type: 'concept', title: 'Permissions', version: 9 },
    });
    await log.flush();

    const rows = lines(log.file);
    expect(rows.map((r) => r.tool)).toEqual(['upsert', 'search', 'list_types', 'upsert']);
    expect(new Set(rows.map((r) => r.session))).toEqual(new Set([log.session]));

    const search = rows[1]!;
    const text = (result.content as { text: string }[]).map((c) => c.text).join('');
    expect(search).toMatchObject({ ok: true, level: 'title', res_chars: text.length });
    expect(search.req_chars).toBeGreaterThan('permissions'.length);
    expect(search.ms).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(search.ts))).toBe(false);

    expect(rows[2]).not.toHaveProperty('level');
    expect(rows[3]!.ok).toBe(false);
  });

  it('stores no query text or node content', async () => {
    const log = openMetricsLog(join(dir, 'mcpdia-metrics.jsonl'));
    await connect(log);
    await client.callTool({ name: 'upsert', arguments: { type: 'concept', title: 'Secret handshake' } });
    await client.callTool({ name: 'search', arguments: { query: 'handshake' } });
    await log.flush();
    expect(readFileSync(log.file, 'utf8').toLowerCase()).not.toMatch(/handshake|secret/);
  });

  it('writes nothing when off', async () => {
    await connect();
    await client.callTool({ name: 'orient', arguments: {} });
    expect(() => readFileSync(join(dir, 'mcpdia-metrics.jsonl'))).toThrow();
  });

  it('never fails a tool call when the log cannot be written', async () => {
    const log = openMetricsLog(join(dir, 'no-such-dir', 'mcpdia-metrics.jsonl'));
    await connect(log);
    const result = await client.callTool({ name: 'orient', arguments: {} });
    await log.flush();
    expect(result.isError).not.toBe(true);
  });
});
