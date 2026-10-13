#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { soloContext } from './context.js';
import { createServer } from './server.js';
import { SqliteStore } from './store/sqlite/SqliteStore.js';

/** Solo mode (ADR 0006): a local SQLite file over stdio. */
async function main(): Promise<void> {
  const dbPath = process.env.MCPEDIA_DB ?? join(homedir(), '.mcpedia', 'mcpedia.db');
  const store = new SqliteStore(dbPath);
  const server = createServer(store, soloContext());

  const shutdown = async () => {
    await server.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so log to stderr.
  console.error(`mcpedia ${dbPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
