import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
const variant = process.env.VARIANT;
const tmp = mkdtempSync(join(tmpdir(), 'mcpdia-diag-'));
const db = join(tmp, 'd.db');
const env = { ...process.env, MCPDIA_DB: db, PORT: '8131' };
const [header, ...rows] = readFileSync('../starters/mcpdia-starter.jsonl', 'utf8').trim().split('\n');
const P = rows.map((row) => ({ row, r: JSON.parse(row) }));
const isLate = (r) => r.kind === 'node' && r.type === 'decision' && Number(r.properties.adr) >= 15;
const early = P.filter((p) => p.r.kind === 'node' && !isLate(p.r));
const late = P.filter((p) => isLate(p.r));
const seed = (n) => {
  const nodes = [...early, ...late.slice(0, n)];
  const keys = new Set(nodes.map((p) => p.r.key));
  const links = P.filter((p) => p.r.kind === 'edge' && keys.has(p.r.fromKey) && keys.has(p.r.toKey));
  const f = join(tmp, 's.jsonl');
  writeFileSync(f, [header, ...nodes.map((p) => p.row), ...links.map((p) => p.row)].join('\n') + '\n');
  execFileSync('node', ['../dist/index.js', 'seed', f, '--namespace', 'mcpdia'], { env, stdio: 'ignore' });
};
seed(0);
const server = spawn('node', ['scripts/serve.mjs', db], { env, stdio: 'ignore' });
await new Promise((d) => setTimeout(d, 1500));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
await page.goto('http://localhost:8131/');
await page.waitForTimeout(1500);
const ROOT = 'mcpdia:concept/mcpdia', DD = 'mcpdia:concept/mcpdia-design-decisions';
const sel = (id) => page.evaluate((id) => window.select(id), id);
const clickNode = async (id) => {
  const position = await page.evaluate((id) => { const p = window.renderer.graphToViewport(window.graph.getNodeAttributes(id)); return { x: p.x, y: p.y }; }, id);
  await page.locator('#graph').click({ position });
};
if (variant === 'direct') await sel(DD);
if (variant === 'viaRoot') { await sel(ROOT); await page.waitForTimeout(1500); await sel(DD); }
if (variant === 'clicks') { await clickNode(ROOT); await page.waitForTimeout(1500); await clickNode(DD); }
await page.waitForTimeout(2500);
const state = () => page.evaluate(() => {
  const g = window.graph, r = window.renderer, d = r.getDimensions();
  const disp = g.mapNodes((id) => r.getNodeDisplayData(id)).filter(Boolean);
  const on = g.filterNodes((id) => { const p = r.graphToViewport(g.getNodeAttributes(id)); return p.x >= 0 && p.x <= d.width && p.y >= 0 && p.y <= d.height; }).length;
  const c = r.getCamera().getState();
  return `order ${g.order} onScreen ${on} displayHidden ${disp.filter((x) => x.hidden).length}/${disp.length} cam(${c.x.toFixed(2)},${c.y.toFixed(2)},r${c.ratio.toFixed(3)}) panel "${document.querySelector('#panel h2, #panel h3, #panel strong')?.textContent ?? ''}"`;
});
const shot = async () => (await page.screenshot({ clip: { x: 260, y: 60, width: 660, height: 640 } })).length;
console.log(variant.padEnd(8), 'before:', await shot(), await state());
seed(3);
await page.waitForTimeout(4500);
console.log(variant.padEnd(8), 'after: ', await shot(), await state(), errs.length ? 'ERR ' + errs[0] : '');
await browser.close();
server.kill();
