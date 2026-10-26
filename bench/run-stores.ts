import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Database from 'better-sqlite3';
import { distractorNodes, otherTopic, parseHits } from './lookups.js';
import { searchWords } from './strategies.js';

/**
 * `npm run bench:stores -- <graph.db> <name>=<url> <name>=<url>` compares MCPdia servers
 * over HTTP, e.g. the SQLite and Postgres Docker stacks loaded with copies of the same
 * graph. No model is called. `graph.db` is a SQLite copy of that graph, read only for
 * the list of nodes to ask about. Writes bench/stores.md and bench/stores.json.
 *
 * It writes to the servers (scratch nodes, then 10,000 filler nodes), so point it at copies.
 */

const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../bench');
const REPEATS = 3;
const FILLER = 10_000;

interface Store {
  name: string;
  call(tool: string, args: Record<string, unknown>): Promise<string>;
}

async function connect(name: string, url: string): Promise<Store> {
  const client = new Client({ name: 'mcpdia-bench', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return {
    name,
    async call(tool, args) {
      const result = await client.callTool({ name: tool, arguments: args });
      const text = (result.content as { text: string }[]).map((c) => c.text).join('\n');
      if (result.isError) throw new Error(`${tool} failed on ${name}: ${text}`);
      return text;
    },
  };
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};
const ms = (x: number) => Number(x.toFixed(1));
async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

interface Node {
  key: string;
  title: string;
  summary: string;
}
const keysOf = (text: string) => parseHits(text).map((h) => h.key);
const query = (text: string) => searchWords(text).join(' ');

/** 1. Do both stores give the same answers to the same calls? */
async function sameAnswers(a: Store, b: Store, list: Node[]) {
  let identical = 0, sameSet = 0, sameTop = 0, sameGet = 0;
  const worst: string[] = [];
  for (const n of list) {
    const args = { query: query(n.title), level: 'title', limit: 5 };
    const [ka, kb] = [keysOf(await a.call('search', args)), keysOf(await b.call('search', args))];
    if (ka.join() === kb.join()) identical++;
    if ([...ka].sort().join() === [...kb].sort().join()) sameSet++;
    if (ka[0] === kb[0]) sameTop++;
    else if (worst.length < 5) worst.push(`"${args.query}": ${a.name} ${ka[0] ?? '-'}, ${b.name} ${kb[0] ?? '-'}`);
    const get = { keys: [n.key], level: 'full' };
    if ((await a.call('get', get)) === (await b.call('get', get))) sameGet++;
  }
  return { n: list.length, identical, sameSet, sameTop, sameGet, worst };
}

/** 2. Does each store find each node from its own title words, and from its summary words? */
async function retrieval(s: Store, list: Node[]) {
  const score = async (field: 'title' | 'summary') => {
    let hit1 = 0, hit3 = 0, rr = 0;
    for (const n of list) {
      const at = keysOf(await s.call('search', { query: query(n[field]), level: 'title', limit: 10 })).indexOf(n.key);
      if (at === 0) hit1++;
      if (at >= 0 && at < 3) hit3++;
      if (at >= 0) rr += 1 / (at + 1);
    }
    return { hit1, hit3, mrr: Number((rr / list.length).toFixed(2)) };
  };
  return { n: list.length, title: await score('title'), summary: await score('summary') };
}

/** 3. Latency per tool call, one warm-up pass then REPEATS timed passes. */
async function latency(s: Store, list: Node[]) {
  const sample = list.slice(0, 40);
  const tools: [string, (n: Node) => Promise<unknown>][] = [
    ['orient', () => s.call('orient', {})],
    ['search', (n) => s.call('search', { query: query(n.summary), level: 'summary', limit: 5 })],
    ['get', (n) => s.call('get', { keys: [n.key], level: 'full' })],
    ['recent', () => s.call('recent', { limit: 10 })],
  ];
  const out: Record<string, { p50: number; p95: number }> = {};
  for (const [tool, fn] of tools) {
    const times: number[] = [];
    for (let r = 0; r <= REPEATS; r++) for (const n of sample) {
      const t = await timed(() => fn(n));
      if (r > 0) times.push(t);
    }
    out[tool] = { p50: ms(percentile(times, 50)), p95: ms(percentile(times, 95)) };
  }
  return out;
}

/** 4. Write timings, on scratch nodes. */
async function writes(s: Store, run: string) {
  const key = (i: number) => `note/bench-scratch-${run}-${i}`;
  const up: number[] = [], sup: number[] = [], del: number[] = [];
  for (let i = 0; i < 50; i++) {
    up.push(await timed(() => s.call('upsert', { key: key(i), type: 'note', title: `Scratch ${run} ${i}`, summary: 'A scratch node for the store bench.', body: 'Nothing to see here.' })));
  }
  for (let i = 0; i < 10; i++) sup.push(await timed(() => s.call('supersede', { old: key(i), summary: 'Replaced scratch node.' })));
  for (let i = 10; i < 20; i++) del.push(await timed(() => s.call('delete', { keys: [key(i)] })));
  const row = (t: number[]) => ({ p50: ms(percentile(t, 50)), p95: ms(percentile(t, 95)) });
  return { upsert: row(up), supersede: row(sup), delete: row(del) };
}

/** 5. Many clients at once: reads only, then one write in four. */
async function concurrency(url: string, name: string, list: Node[], run: string) {
  const rows = [];
  for (const mixed of [false, true]) {
    for (const clients of [1, 4, 16]) {
      const perClient = 40;
      const stores = await Promise.all(Array.from({ length: clients }, () => connect(name, url)));
      const times: number[] = [];
      let errors = 0;
      const start = performance.now();
      await Promise.all(stores.map(async (s, c) => {
        for (let i = 0; i < perClient; i++) {
          const n = list[(c * perClient + i) % list.length]!;
          const write = mixed && i % 4 === 0;
          try {
            times.push(await timed(() => write
              ? s.call('upsert', { key: `note/bench-load-${run}-${mixed}-${clients}-${c}-${i}`, type: 'note', title: `Load ${c} ${i}`, summary: 'Concurrency bench node.' })
              : s.call('search', { query: query(n.summary), level: 'summary', limit: 5 })));
          } catch {
            errors++;
          }
        }
      }));
      const seconds = (performance.now() - start) / 1000;
      rows.push({ mixed, clients, calls: clients * perClient, perSecond: Math.round((clients * perClient) / seconds), p95: ms(percentile(times, 95)), errors });
    }
  }
  return rows;
}

async function fill(s: Store, words: string[]) {
  const start = performance.now();
  for (const n of distractorNodes(FILLER, words)) {
    await s.call('upsert', { key: n.key, type: n.key.split('/')[0], title: n.title, summary: n.summary, body: n.body });
  }
  return Number(((performance.now() - start) / 1000).toFixed(1));
}

function docsText(dir: string): string {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
    .join('\n');
}

async function main(): Promise<void> {
  const [dbPath, ...targets] = process.argv.slice(2);
  if (!dbPath || targets.length !== 2) throw new Error('Usage: npm run bench:stores -- graph.db sqlite=http://… postgres=http://…');
  const db = new Database(dbPath, { readonly: true });
  const list = db.prepare("SELECT key, title, coalesce(summary, title) AS summary FROM nodes WHERE status = 'active' ORDER BY key").all() as Node[];
  db.close();
  const named = targets.map((t) => { const at = t.indexOf('='); return { name: t.slice(0, at), url: t.slice(at + 1) }; });
  const stores = await Promise.all(named.map((t) => connect(t.name, t.url)));
  const [a, b] = stores as [Store, Store];
  const run = Date.now().toString(36);
  const log = (m: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${m}`);

  log('1. same answers'); const same = await sameAnswers(a, b, list);
  const result: Record<string, unknown> = { nodes: list.length, same, stores: {} as Record<string, unknown> };
  const per = result.stores as Record<string, Record<string, unknown>>;
  for (const [i, s] of stores.entries()) {
    log(`${s.name}: retrieval, latency, writes, concurrency`);
    per[s.name] = {
      retrieval: await retrieval(s, list),
      latency: await latency(s, list),
      writes: await writes(s, run),
      concurrency: await concurrency(named[i]!.url, s.name, list, run),
    };
  }
  const words = otherTopic(docsText(join(BENCH_DIR, '../docs')));
  for (const [i, s] of stores.entries()) {
    log(`${s.name}: adding ${FILLER} filler nodes`);
    const loadSeconds = await fill(s, words);
    log(`${s.name}: repeating at ${FILLER} more nodes`);
    per[s.name]!.scaled = {
      loadSeconds,
      retrieval: await retrieval(s, list),
      latency: await latency(s, list),
      concurrency: await concurrency(named[i]!.url, s.name, list, `${run}x`),
    };
  }

  writeFileSync(join(BENCH_DIR, 'stores.json'), JSON.stringify(result, null, 2) + '\n');
  const L: string[] = ['# SQLite and Postgres over HTTP', ''];
  L.push(`${list.length} active nodes, copies of one graph. No model. ${REPEATS} timed passes per latency row.`, '');
  L.push('## 1. Same answers', '');
  L.push(`Of ${same.n} title searches (top 5): identical ${same.identical}, same set ${same.sameSet}, same top hit ${same.sameTop}. Identical get text: ${same.sameGet}/${same.n}.`, '');
  for (const w of same.worst) L.push(`- ${w}`);
  const names = stores.map((s) => s.name);
  const r = (s: string, k: 'title' | 'summary', scaled = false) => {
    const x = ((scaled ? (per[s]!.scaled as never as { retrieval: never }).retrieval : per[s]!.retrieval) as never as Record<string, { hit1: number; hit3: number; mrr: number }>)[k]!;
    return `${x.hit1} / ${x.hit3} / ${x.mrr}`;
  };
  L.push('', `## 2. Retrieval (hit@1 / hit@3 / MRR, of ${list.length})`, '', `| | ${names.join(' | ')} | ${names.map((n) => `${n} +${FILLER / 1000}k`).join(' | ')} |`, '|---|---|---|---|---|');
  for (const k of ['title', 'summary'] as const) L.push(`| ${k} words | ${names.map((n) => r(n, k)).join(' | ')} | ${names.map((n) => r(n, k, true)).join(' | ')} |`);
  const lat = (s: string, scaled = false) => ((scaled ? (per[s]!.scaled as never as { latency: never }).latency : per[s]!.latency) as never as Record<string, { p50: number; p95: number }>);
  L.push('', '## 3. Latency, ms p50 / p95', '', `| Tool | ${names.join(' | ')} | ${names.map((n) => `${n} +${FILLER / 1000}k`).join(' | ')} |`, '|---|---|---|---|---|');
  for (const t of ['orient', 'search', 'get', 'recent']) L.push(`| ${t} | ${names.map((n) => `${lat(n)[t]!.p50} / ${lat(n)[t]!.p95}`).join(' | ')} | ${names.map((n) => `${lat(n, true)[t]!.p50} / ${lat(n, true)[t]!.p95}`).join(' | ')} |`);
  L.push('', '## 4. Writes, ms p50 / p95', '', `| Tool | ${names.join(' | ')} |`, '|---|---|---|');
  for (const t of ['upsert', 'supersede', 'delete']) L.push(`| ${t} | ${names.map((n) => { const w = (per[n]!.writes as Record<string, { p50: number; p95: number }>)[t]!; return `${w.p50} / ${w.p95}`; }).join(' | ')} |`);
  L.push('', `Loading ${FILLER} filler nodes one upsert at a time: ${names.map((n) => `${n} ${(per[n]!.scaled as { loadSeconds: number }).loadSeconds} s`).join(', ')}.`);
  L.push('', '## 5. Concurrency: calls per second, p95 ms, errors', '', `| Mix | Clients | ${names.join(' | ')} | ${names.map((n) => `${n} +${FILLER / 1000}k`).join(' | ')} |`, '|---|---|---|---|---|---|');
  type Row = { mixed: boolean; clients: number; perSecond: number; p95: number; errors: number };
  const rowsOf = (n: string, scaled = false) => (scaled ? (per[n]!.scaled as { concurrency: Row[] }).concurrency : per[n]!.concurrency) as Row[];
  rowsOf(names[0]!).forEach((row, i) => {
    const cell = (x: Row) => `${x.perSecond}/s, ${x.p95}${x.errors ? `, ${x.errors} err` : ''}`;
    L.push(`| ${row.mixed ? '1 write in 4' : 'reads'} | ${row.clients} | ${names.map((n) => cell(rowsOf(n)[i]!)).join(' | ')} | ${names.map((n) => cell(rowsOf(n, true)[i]!)).join(' | ')} |`);
  });
  L.push('', `Machine: ${process.platform}, Node ${process.version}, both servers in Docker on the same machine.`);
  writeFileSync(join(BENCH_DIR, 'stores.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
