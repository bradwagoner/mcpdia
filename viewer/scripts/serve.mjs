// Serves the viewer and reads the graph live, so the page can follow changes the MCP server makes.
// Usage (from viewer/): npm start  [-- path/to/mcpdia.db]
//                        npm run dev [-- path/to/mcpdia.db]   also rebuilds on save and reloads the page
//                        add --lan to open it to other devices on your network
// Listens on 127.0.0.1 only (or every interface with --lan), answers only to this machine's own
// names, and opens the database read-only.
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dataVersion, defaultDbPath, openGraph, readGraph } from './read-graph.mjs';

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith('--')) ?? defaultDbPath();
const devMode = args.includes('--watch');
const lanMode = args.includes('--lan');
const port = Number(process.env.PORT ?? 8000);
const root = fileURLToPath(new URL('../www/', import.meta.url));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
};

const db = openGraph(dbPath);

// Only this machine's own names. A web page on another site can point its own host name at 127.0.0.1
// (DNS rebinding) and read the graph as if it were same-origin; checking Host stops that.
// With --lan, this machine's network addresses and host name count as its own names too.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && !a.internal)
  .map((a) => (a.family === 'IPv6' ? `[${a.address}]` : a.address));
if (lanMode) {
  for (const name of [...lanAddresses, hostname(), `${hostname()}.local`]) LOCAL_HOSTS.add(name.toLowerCase());
}
const isLocalHost = (host = '') => LOCAL_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase());

const server = createServer(async (req, res) => {
  if (!isLocalHost(req.headers.host)) return send(res, 403, 'text/plain', 'Forbidden: open the viewer at localhost');
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  try {
    if (path === '/api/reload') return listenForReload(res);
    if (path === '/api/version') return send(res, 200, 'text/plain', String(dataVersion(db)));
    if (path === '/api/graph') {
      const body = JSON.stringify({ source: dbPath, version: String(dataVersion(db)), ...readGraph(db) });
      return send(res, 200, 'application/json', body);
    }
    // Static files from www/, never outside it.
    const file = normalize(join(root, path === '/' ? 'index.html' : decodeURIComponent(path)));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return send(res, 403, 'text/plain', 'Forbidden');
    send(res, 200, types[extname(file)] ?? 'application/octet-stream', await readFile(file));
  } catch (err) {
    send(res, err.code === 'ENOENT' ? 404 : 500, 'text/plain', err.code === 'ENOENT' ? 'Not found' : String(err));
  }
});

// Pages listen here and reload themselves after a rebuild (dev mode only; otherwise the stream stays quiet).
const reloadListeners = new Set();
function listenForReload(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  reloadListeners.add(res);
  res.on('close', () => reloadListeners.delete(res));
}
function reloadPages() {
  for (const res of reloadListeners) res.write('data: reload\n\n');
}

if (devMode) {
  const esbuild = await import('esbuild');
  const ctx = await esbuild.context({
    entryPoints: { viewer: 'src/main.ts', cytoscape: 'src/cytoscape.ts' },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outdir: 'www',
    logLevel: 'info',
    plugins: [{ name: 'reload', setup: (build) => build.onEnd((r) => r.errors.length || reloadPages()) }],
  });
  await ctx.watch();
  let timer;
  watch(join(root, 'index.html'), () => {
    clearTimeout(timer);
    timer = setTimeout(reloadPages, 100);
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

server.listen(port, lanMode ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Viewer on http://localhost:${port} (live from ${dbPath}${devMode ? ', reloads on save' : ''})`);
  if (!lanMode) return;
  const urls = lanAddresses.filter((a) => !a.startsWith('[')).map((a) => `http://${a}:${port}`);
  console.log(`On your network: ${urls.join(', ') || 'no network address found'}`);
  console.log('Anyone on this network can read the graph (read-only, no login). Use --lan on trusted networks only.');
});
