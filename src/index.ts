#!/usr/bin/env node
import { once } from 'node:events';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { assertNotDatabase, errorLine, pickCommand, writeLinesAtomically } from './cli.js';
import { soloContext } from './context.js';
import { exportJsonl, type ExportInput } from './core/export.js';
import { openMetricsLog } from './metrics.js';
import { createServer } from './server.js';
import { SqliteStore } from './store/sqlite/SqliteStore.js';

const dbPath = process.env.MCPEDIA_DB ?? join(homedir(), '.mcpedia', 'mcpedia.db');

const EXPORT_USAGE = `Usage: mcpedia export [--namespace ns]... [--all-status] [--out file]

Writes the graph as JSON Lines to stdout, or to --out.
Exports active nodes only; --all-status adds superseded and deleted nodes.
Reads ${dbPath} (set MCPEDIA_DB to use another database).`;

/** `mcpedia export [--namespace ns]... [--all-status] [--out file]`: JSONL to a file or stdout. */
async function runExport(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      namespace: { type: 'string', multiple: true },
      'all-status': { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(EXPORT_USAGE);
    return;
  }
  // A reader that stops early (`mcpedia export | head`) is fine; stop quietly.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  if (values.out) assertNotDatabase(values.out, dbPath);
  const store = new SqliteStore(dbPath);
  const input: ExportInput = { namespaces: values.namespace, allStatus: values['all-status'] };
  const run = (write: (line: string) => void | Promise<void>) => exportJsonl(soloContext(), store, input, write);
  try {
    const header = values.out
      ? await writeLinesAtomically(values.out, run)
      : await run(async (line) => {
          // Wait when the reader is slower than the export, so lines don't pile up in memory.
          if (!process.stdout.write(line + '\n')) await once(process.stdout, 'drain');
        });
    console.error(`exported ${header.nodes} nodes, ${header.edges} edges from ${dbPath}`);
  } finally {
    await store.close();
  }
}

/** Solo mode (ADR 0006): a local SQLite file over stdio. */
async function main(): Promise<void> {
  const store = new SqliteStore(dbPath);
  const metrics =
    process.env.MCPEDIA_METRICS === '1' ? openMetricsLog(join(dirname(dbPath), 'mcpedia-metrics.jsonl')) : undefined;
  const server = createServer(store, soloContext(), { metrics });

  const shutdown = async () => {
    await server.close();
    await metrics?.flush();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so log to stderr.
  console.error(`mcpedia ${dbPath}`);
  if (metrics) console.error(`metrics ${metrics.file}`);
}

async function run(argv: string[]): Promise<void> {
  const { command, args } = pickCommand(argv);
  if (command === 'export') return runExport(args);
  return main();
}

run(process.argv.slice(2)).catch((err) => {
  console.error(errorLine(err) ?? err);
  process.exit(1);
});
