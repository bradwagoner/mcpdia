#!/usr/bin/env node
import { once } from 'node:events';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { assertNotDatabase, errorLine, pickCommand, writeLinesAtomically } from './cli.js';
import { checkNamespace, configFromEnv, type Config } from './context.js';
import { UserError } from './core/errors.js';
import { exportJsonl, type ExportInput } from './core/export.js';
import { loadStarter } from './core/starters.js';
import { openMetricsLog } from './metrics.js';
import { serveHttp } from './http.js';
import { createServer } from './server.js';
import { describeLoad, loadStarters, readSource } from './starters.js';
import type { GraphStore } from './store/GraphStore.js';
import { connectPool } from './store/postgres/db.js';
import { PostgresStore } from './store/postgres/PostgresStore.js';
import { SqliteStore } from './store/sqlite/SqliteStore.js';

const dbPath = process.env.MCPDIA_DB ?? join(homedir(), '.mcpdia', 'mcpdia.db');
/** When set, the graph lives in Postgres and MCPDIA_DB is ignored (ADR 0025). */
const databaseUrl = process.env.MCPDIA_DATABASE_URL;
/** Where the graph is, for messages. A Postgres password is never printed. */
const where = databaseUrl ? withoutPassword(databaseUrl) : dbPath;
/** Relative paths in MCPDIA_STARTERS start here: next to the database, whatever folder the client starts us in. */
const startersDir = databaseUrl ? process.cwd() : dirname(dbPath);

async function openStore(): Promise<GraphStore> {
  return databaseUrl ? PostgresStore.open(connectPool(databaseUrl)) : new SqliteStore(dbPath);
}

function withoutPassword(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'MCPDIA_DATABASE_URL';
  }
}

const EXPORT_USAGE = `Usage: mcpdia export [--namespace ns]... [--tag tag]... [--all-status] [--out file]

Writes the graph as JSON Lines to stdout, or to --out.
Exports active nodes only; --all-status adds superseded and deleted nodes.
--tag keeps nodes with that tag and the links between them, e.g. to make a starter set.
Reads ${where} (set MCPDIA_DB to use another file, or MCPDIA_DATABASE_URL for Postgres).`;

/** `mcpdia export [--namespace ns]... [--tag tag]... [--all-status] [--out file]`: JSONL to a file or stdout. */
async function runExport(config: Config, args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      namespace: { type: 'string', multiple: true },
      tag: { type: 'string', multiple: true },
      'all-status': { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(EXPORT_USAGE);
    return;
  }
  // A reader that stops early (`mcpdia export | head`) is fine; stop quietly.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  if (values.out && !databaseUrl) assertNotDatabase(values.out, dbPath);
  const store = await openStore();
  const input: ExportInput = { namespaces: values.namespace, tags: values.tag, allStatus: values['all-status'] };
  const run = (write: (line: string) => void | Promise<void>) => exportJsonl(config.ctx, store, input, write);
  try {
    const header = values.out
      ? await writeLinesAtomically(values.out, run)
      : await run(async (line) => {
          // Wait when the reader is slower than the export, so lines don't pile up in memory.
          if (!process.stdout.write(line + '\n')) await once(process.stdout, 'drain');
        });
    console.error(`exported ${header.nodes} nodes, ${header.edges} edges from ${where}`);
  } finally {
    await store.close();
  }
}

const SEED_USAGE = `Usage: mcpdia seed <file or url> --namespace ns

Loads an mcpdia export into namespace ns, which then mirrors it: new and changed
nodes are written, nodes gone from the export are marked deleted. Running it
again with the same export changes nothing. Writes to ${where}.
To load sets every time the server starts, set MCPDIA_STARTERS instead.`;

/** `mcpdia seed <file|url> --namespace ns`: a one-off starter load (ADR 0026). */
async function runSeed(config: Config, args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { namespace: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  const [source] = positionals;
  if (values.help || !source || !values.namespace || positionals.length > 1) {
    console.log(SEED_USAGE);
    if (!values.help) process.exitCode = 1;
    return;
  }
  const namespace = checkNamespace(values.namespace, '--namespace');
  if (namespace === config.ctx.writeNamespace) {
    throw new UserError(
      `--namespace ${namespace} is the write namespace.`,
      'Seeding mirrors the export, so it would mark your own nodes deleted. Pick another namespace.',
    );
  }
  // On the command line a relative path means the current folder, as usual.
  const text = await readSource(source, process.cwd());
  const store = await openStore();
  try {
    console.error(describeLoad(await loadStarter(store, namespace, source, text)));
    if (!config.ctx.namespaces.includes(namespace)) {
      console.error(`To read it, add ${namespace} to MCPDIA_NAMESPACES, or name it in MCPDIA_STARTERS.`);
    }
  } finally {
    await store.close();
  }
}

/**
 * Serves over stdio by default (ADR 0006). `--http` serves over HTTP instead, at
 * MCPDIA_HTTP_HOST:MCPDIA_HTTP_PORT (default 127.0.0.1:7411) (ADR 0025).
 */
async function main(config: Config, args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { http: { type: 'boolean' } } });
  const store = await openStore();
  await loadStarters(store, config.starters, startersDir, (line) => console.error(line));
  const metricsFile = process.env.MCPDIA_METRICS_FILE ?? join(dirname(dbPath), 'mcpdia-metrics.jsonl');
  const metrics = process.env.MCPDIA_METRICS === '1' ? openMetricsLog(metricsFile) : undefined;
  const makeServer = () => createServer(store, config.ctx, { metrics });

  let stop: () => Promise<void>;
  if (values.http) {
    const host = process.env.MCPDIA_HTTP_HOST ?? '127.0.0.1';
    const port = Number(process.env.MCPDIA_HTTP_PORT ?? 7411);
    const allowedHosts = (process.env.MCPDIA_HTTP_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);
    const exportGraph = (query: URLSearchParams, write: (line: string) => Promise<void>) =>
      exportJsonl(config.ctx, store, { namespaces: query.getAll('namespace'), tags: query.getAll('tag') }, write);
    const http = await serveHttp(makeServer, { host, port, allowedHosts, exportGraph });
    stop = () => new Promise((done) => http.close(() => done()));
    console.error(`mcpdia ${where}\nlistening on http://${host}:${port}/mcp`);
  } else {
    const server = makeServer();
    await server.connect(new StdioServerTransport());
    stop = () => server.close();
    // stdout carries the protocol, so log to stderr.
    console.error(`mcpdia ${where}`);
  }
  if (metrics) console.error(`metrics ${metrics.file}`);

  const shutdown = async () => {
    await stop();
    await metrics?.flush();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function run(argv: string[]): Promise<void> {
  const { command, args } = pickCommand(argv);
  const config = configFromEnv(process.env);
  if (command === 'export') return runExport(config, args);
  if (command === 'seed') return runSeed(config, args);
  return main(config, args);
}

run(process.argv.slice(2)).catch((err) => {
  console.error(errorLine(err) ?? err);
  process.exit(1);
});
