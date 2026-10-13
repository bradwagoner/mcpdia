#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { soloContext } from './context.js';
import { exportJsonl } from './core/export.js';
import { createServer } from './server.js';
import { SqliteStore } from './store/sqlite/SqliteStore.js';

const dbPath = process.env.MCPEDIA_DB ?? join(homedir(), '.mcpedia', 'mcpedia.db');

/** `mcpedia export [--namespace ns]... [--out file]`: JSONL to a file or stdout. */
async function runExport(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { namespace: { type: 'string', multiple: true }, out: { type: 'string' } },
  });
  const store = new SqliteStore(dbPath);
  const out = values.out ? createWriteStream(values.out) : process.stdout;
  try {
    const header = await exportJsonl(soloContext(), store, { namespaces: values.namespace }, (line) => {
      out.write(line + '\n');
    });
    if (out !== process.stdout) await new Promise<void>((done) => out.end(() => done()));
    console.error(`exported ${header.nodes} nodes, ${header.edges} edges from ${dbPath}`);
  } finally {
    await store.close();
  }
}

/** Solo mode (ADR 0006): a local SQLite file over stdio. */
async function main(): Promise<void> {
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

const [command, ...rest] = process.argv.slice(2);
(command === 'export' ? runExport(rest) : main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
