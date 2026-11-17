// Records the viewer clips used in the README and on the website: one short video per scene,
// plus a GIF of each when ffmpeg is on the PATH, and the two README screenshots.
// Usage (from viewer/): node scripts/record-demo.mjs [scene ...] [--out=dir]
//   scenes: tree, node, search, grow (all of them when none is named)
// Needs the repo built (`npm run build` at the root and here) and Playwright's browser
// (`npx playwright install chromium`). Works on a throwaway database; no real graph is touched.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const OUT = resolve(args.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? '../docs/images');
const wanted = args.filter((a) => !a.startsWith('--'));
const STARTER = '../starters/mcpdia-starter.jsonl';
const PORT = 8130;
const SIZE = { width: 1280, height: 720 };
const id = (key) => `mcpdia:${key}`;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const tmp = mkdtempSync(join(tmpdir(), 'mcpdia-demo-'));
const db = join(tmp, 'demo.db');
const env = { ...process.env, MCPDIA_DB: db, PORT: String(PORT) };

// The starter set, with the newest decision records held back so the grow scene can add them on camera.
const [header, ...rows] = readFileSync(STARTER, 'utf8').trim().split('\n');
const parsed = rows.map((row) => ({ row, record: JSON.parse(row) }));
const edges = parsed.filter((p) => p.record.kind === 'edge');
const isLate = (r) => r.kind === 'node' && r.type === 'decision' && Number(r.properties.adr) >= 15;
const early = parsed.filter((p) => p.record.kind === 'node' && !isLate(p.record)).map((p) => p.row);
const late = parsed
  .filter((p) => isLate(p.record))
  .sort((a, b) => a.record.properties.adr.localeCompare(b.record.properties.adr))
  .map((p) => p.row);
function seed(lateCount = late.length) {
  const file = join(tmp, 'slice.jsonl');
  const nodes = [...early, ...late.slice(0, lateCount)];
  // Only links between nodes that are in, so a held-back node doesn't show up early as a ghost.
  const keys = new Set(nodes.map((row) => JSON.parse(row).key));
  const links = edges.filter((e) => keys.has(e.record.fromKey) && keys.has(e.record.toKey)).map((e) => e.row);
  writeFileSync(file, [header, ...nodes, ...links].join('\n') + '\n');
  execFileSync('node', ['../dist/index.js', 'seed', file, '--namespace', 'mcpdia'], { env, stdio: 'ignore' });
}

seed();
const server = spawn('node', ['scripts/serve.mjs', db], { env, stdio: 'ignore' });
await wait(1500);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: SIZE });
mkdirSync(OUT, { recursive: true });

// A node is drawn on the canvas, so it is clicked at the spot where the renderer put it.
async function clickNode(key) {
  const position = await page.evaluate((node) => {
    const p = window.renderer.graphToViewport(window.graph.getNodeAttributes(node));
    // The open panel covers the right of the graph: a box whose middle is under it is clicked on the part still showing.
    const panel = document.getElementById('panel');
    const edge = panel.hidden ? Infinity : panel.getBoundingClientRect().left - 14;
    return { x: Math.min(p.x, edge - document.getElementById('graph').getBoundingClientRect().left), y: p.y };
  }, id(key));
  await page.locator('#graph').click({ position });
  // The panel opens on the node that was hit, so a click that landed elsewhere stops the recording.
  await wait(300);
  const title = await page.evaluate((node) => window.graph.getNodeAttribute(node, 'title'), id(key));
  const panel = (await page.locator('#panel').textContent()) ?? '';
  if (!panel.startsWith(title)) throw new Error(`Clicked for "${title}" but the panel shows "${panel.slice(0, 40)}"`);
}
const fullText = () => page.locator('#panel details > summary').click({ position: { x: 34, y: 10 } });
// Every scene starts from the same place: a fresh view, nothing selected.
async function fresh() {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await wait(1500);
}

// A scene that ends on a view worth keeping returns a file name, and that view is saved as a screenshot.
const scenes = {
  // The family tree around the top node.
  async tree() {
    await wait(800);
    await clickNode('concept/mcpdia');
    await wait(3000);
    return 'viewer-tree.png';
  },
  // Walk down to two nodes and read each in full.
  async node() {
    await clickNode('concept/mcpdia');
    await wait(1800);
    await clickNode('concept/mcpdia-tools');
    await wait(2200);
    await clickNode('concept/tool-orient');
    await wait(1500);
    await fullText();
    await wait(3500);
    // At this frame size the search tool's box is under the open panel, so follow its link in the panel instead.
    await page.locator('#panel a').getByText('search tool', { exact: true }).click();
    await wait(1500);
    await fullText();
    await wait(3500);
  },
  // Search, then open a result and read it in full.
  async search() {
    await page.locator('#search').click();
    await page.locator('#search').pressSequentially('install', { delay: 130 });
    await wait(1800);
    await page.locator('#results').getByText('Install MCPdia', { exact: true }).click();
    await wait(1800);
    await fullText();
    await wait(4000);
    return 'viewer-search.png';
  },
  // Watch it grow: twelve decision records arrive, three at a time, as an agent's writes would.
  async grow() {
    await clickNode('concept/mcpdia');
    await wait(1500);
    await clickNode('concept/mcpdia-design-decisions');
    await wait(2000);
    for (let count = 3; count <= late.length; count += 3) {
      seed(count);
      await wait(3500); // the page polls every 3 seconds
    }
    await wait(1500);
    return 'viewer-grow.png';
  },
};

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
// 12 frames a second at 960px wide keeps a GIF to a few megabytes.
const GIF = 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse';
page.setDefaultTimeout(5000);
try {
  for (const name of wanted.length ? wanted : Object.keys(scenes)) {
    if (!scenes[name]) throw new Error(`No scene "${name}". Scenes: ${Object.keys(scenes).join(', ')}`);
    seed(name === 'grow' ? 0 : late.length);
    await fresh();
    const video = join(OUT, `viewer-${name}.webm`);
    await page.screencast.start({ path: video, size: SIZE });
    // Playwright's own click marks: a pointer that travels to each click and a ring where it lands.
    await page.screencast.showActions({
      duration: 800,
      style: {
        point: 'width: 44px; height: 44px; border-radius: 50%; border: 4px solid #f28e2b; box-sizing: border-box',
        title: 'display: none',
      },
    });
    const still = await scenes[name]();
    await page.screencast.stop();
    if (still) {
      // The click marks and the hover highlight under the pointer belong in the video, not in a still.
      await page.screencast.hideActions();
      await page.mouse.move(1, 1);
      await wait(400);
      await page.screenshot({ path: join(OUT, still) });
    }
    if (ffmpeg)
      execFileSync('ffmpeg', ['-y', '-i', video, '-vf', GIF, join(OUT, `viewer-${name}.gif`)], { stdio: 'ignore' });
    console.log(`Recorded ${name}${ffmpeg ? '' : ' (video only: ffmpeg is not on the PATH, so no GIF)'}`);
  }
  console.log(`Wrote to ${OUT}`);
} finally {
  // A scene that fails still closes the browser and the server it started.
  await browser.close();
  server.kill();
}
