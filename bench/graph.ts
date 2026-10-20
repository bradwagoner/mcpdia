import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { soloContext } from '../src/context.js';
import { createServer } from '../src/server.js';
import { SqliteStore } from '../src/store/sqlite/SqliteStore.js';
import { type DemoNode, nodes } from './dataset/index.js';
import { typeOf } from './dataset/types.js';

/** An MCP client wired to a real MCPdia server, so the benchmark reads exactly what a model would. */
export interface GraphSession {
  client: Client;
  /** Calls a tool and returns its text, throwing on a tool error. */
  call(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function openSession(dbPath = ':memory:'): Promise<GraphSession> {
  const store = new SqliteStore(dbPath);
  const server = createServer(store, soloContext());
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'mcpedia-bench', version: '0' });
  await client.connect(clientSide);

  async function call(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n');
    if (result.isError) throw new Error(`${name} failed: ${text}`);
    return text;
  }

  return {
    client,
    call,
    async close() {
      await client.close();
      await store.close();
    },
  };
}

/** Writes the demo dataset through the public tools: every node, then every link. */
export async function seed(session: GraphSession, data: DemoNode[] = nodes): Promise<void> {
  for (const node of data) {
    await session.call('upsert', {
      key: node.key,
      type: typeOf(node),
      title: node.title,
      summary: node.summary,
      body: node.body,
      ...(node.tags ? { tags: node.tags } : {}),
      ...(node.aliases ? { aliases: node.aliases } : {}),
    });
  }
  for (const node of data) {
    for (const [type, to] of node.links ?? []) await session.call('link', { from: node.key, to, type });
  }
}
