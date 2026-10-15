// MCPedia graph viewer, Cytoscape.js edition. Same page and features as main.ts, so the two
// libraries can be compared side by side. Open with ?renderer=cytoscape.
// Cytoscape holds the data and renders it; neighbor groups are Cytoscape compound (parent) nodes.
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from 'cytoscape';
import { UndirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { describeType } from './descriptions';
import { family, relationText, SIZES, UNDER_EDGES, type FamilyGraph } from './family';

interface ExportedNode {
  id: string;
  key: string;
  type: string;
  title: string;
  summary: string | null;
  body: string | null;
  properties: Record<string, unknown>;
  status: string;
}
interface ExportedGraph {
  source: string;
  typeDefs: { kind: string; name: string; description: string | null }[];
  nodes: ExportedNode[];
  edges: { from: string; to: string; type: string; note?: string | null }[];
  pinned?: string[];
}
type Mode = 'lists' | 'network';
type Point = { x: number; y: number };

const GHOST_TYPE = '(ghost)';
const PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#86bcb6',
  '#d37295',
  '#a0cbe8',
];
// The family tree around a selection (family.ts), with slightly smaller boxes than the Sigma version.
const GROUP = { ...SIZES, boxWidth: 170, boxHeight: 24, selectedWidth: 170 };
const LIST = { colWidth: 230, rowHeight: 32 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Data ----------
// From the live server (`npm start`) or a file (`?data=...`), exactly as in main.ts.

const params = new URLSearchParams(location.search);
const fileParam = params.get('data');
let dataUrl = fileParam ?? 'api/graph';
async function fetchGraph(): Promise<ExportedGraph> {
  const r = await fetch(dataUrl, { cache: 'no-store' });
  if (r.ok) return r.json();
  if (!fileParam && dataUrl === 'api/graph') {
    dataUrl = 'data/mcpedia.json';
    return fetchGraph();
  }
  throw new Error(`Could not load ${dataUrl} (${r.status}). Run "npm start", or "npm run export" then "npm run dev".`);
}
const live = () => dataUrl === 'api/graph';

const typeColor = new Map<string, string>();
const colorFor = (type: string) => {
  if (type === GHOST_TYPE) return '#999';
  if (!typeColor.has(type)) typeColor.set(type, PALETTE[typeColor.size % PALETTE.length]);
  return typeColor.get(type)!;
};
const shortLabel = (text: string) => (text.length > 26 ? `${text.slice(0, 25)}…` : text);
const typeDefs = new Map<string, string | null>();
const help = (kind: 'node' | 'edge', name: string) => typeDefs.get(`${kind}:${name}`) ?? describeType(kind, name);

// Home positions per layout. Selecting a node moves its neighbors into groups; these are where they go back to.
const netPos = new Map<string, Point>();
const listPos = new Map<string, Point>();

const cy: Core = cytoscape({
  container: $('graph'),
  minZoom: 0.05,
  maxZoom: 4,
  style: [
    {
      selector: 'node.item',
      style: {
        shape: 'round-rectangle',
        'background-color': 'data(color)',
        label: 'data(label)',
        color: '#fff',
        'font-size': 10,
        'text-valign': 'center',
        'text-halign': 'center',
        width: 'data(w)',
        height: 18,
      },
    },
    // Network view: circles sized by how much sits under them (data d), labels beside them, or inside
    // once they fit. Labels can be clicked like the circles.
    {
      selector: 'node.item.net',
      style: {
        shape: 'ellipse',
        width: 'data(d)',
        height: 'data(d)',
        color: '#222',
        'text-halign': 'right',
        'text-margin-x': 4,
        'font-size': 11,
        'text-events': 'yes',
        'min-zoomed-font-size': 5,
      },
    },
    { selector: 'node.item.net.inside', style: { color: '#fff', 'text-halign': 'center', 'text-margin-x': 0 } },
    {
      selector: 'node.item[?big]',
      style: {
        shape: 'round-rectangle',
        width: GROUP.boxWidth,
        height: GROUP.boxHeight,
        'font-size': 11,
        color: '#fff',
        'text-halign': 'center',
        'text-margin-x': 0,
      },
    },
    { selector: 'node.item.focus', style: { 'border-width': 3, 'border-color': '#222', 'font-weight': 'bold' } },
    {
      selector: 'node.group',
      style: {
        shape: 'round-rectangle',
        'background-opacity': 0.06,
        'background-color': 'data(color)',
        'border-width': 0,
        label: 'data(label)',
        color: 'data(color)',
        'font-size': 11,
        'font-weight': 'bold',
        'text-valign': 'top',
        'text-halign': 'center',
        padding: '6px',
      },
    },
    {
      selector: 'node.header',
      style: {
        shape: 'round-rectangle',
        'background-color': '#fff',
        'border-width': 0,
        label: 'data(label)',
        'font-size': 14,
        'font-weight': 'bold',
        color: 'data(color)',
        'text-valign': 'center',
        width: LIST.colWidth - 30,
        height: 24,
        events: 'no',
      },
    },
    {
      selector: 'edge',
      style: { width: 1, 'line-color': '#bbb', 'curve-style': 'straight', 'target-arrow-shape': 'none', opacity: 0.6 },
    },
    { selector: 'edge.near', style: { 'line-color': '#666', opacity: 1, width: 1.2 } },
    { selector: '.faded', style: { opacity: 0.12, label: '' } },
    { selector: 'edge.faded', style: { opacity: 0.05 } },
    { selector: '.gone', style: { display: 'none' } },
  ],
});

// Loads data into Cytoscape, keeping existing nodes where they are. Returns the ids of new nodes.
function applyData(data: ExportedGraph) {
  typeDefs.clear();
  for (const t of data.typeDefs) typeDefs.set(`${t.kind}:${t.name}`, t.description);
  [...countBy(data.nodes.map((n) => n.type)).keys()].forEach(colorFor);

  const added: string[] = [];
  const keep = new Set<string>();
  const fresh: ElementDefinition[] = [];
  const upsert = (id: string, title: string, type: string, raw: ExportedNode | null) => {
    keep.add(id);
    const label = shortLabel(title);
    const d = { label, title, type, color: colorFor(type), raw, w: Math.max(40, label.length * 5.6 + 14) };
    const existing = cy.getElementById(id);
    if (existing.nonempty()) existing.data(d);
    else {
      fresh.push({ group: 'nodes', data: { id, ...d }, classes: 'item', position: { x: 0, y: 0 } });
      added.push(id);
    }
  };
  for (const n of data.nodes) upsert(n.id, n.title || n.key, n.type, n);
  // Edges are late-bound (ADR 0007): a missing end shows as a grey ghost node.
  for (const e of data.edges)
    for (const end of [e.from, e.to]) if (!keep.has(end)) upsert(end, end.replace(/^default:/, ''), GHOST_TYPE, null);

  cy.batch(() => {
    cy.edges().remove();
    cy.nodes('.item')
      .filter((n) => !keep.has(n.id()))
      .remove();
    cy.add(fresh);
    cy.add(
      data.edges.map((e, i) => ({
        group: 'edges' as const,
        data: { id: `e${i}`, source: e.from, target: e.to, type: e.type, note: e.note ?? null },
      })),
    );
  });
  for (const id of netPos.keys()) if (!keep.has(id)) netPos.delete(id);
  pinned = new Set(data.pinned ?? []);
  sizeCircles();
  return added;
}

const items = () => cy.nodes('.item');

// ---------- Layouts ----------

// New nodes start next to the neighbors they link to, so an update doesn't reshuffle the view.
function placeNewNodes(added: string[], saved: Record<string, [number, number]>) {
  const fresh = new Set(added);
  for (const id of added) {
    if (!saved[id]) continue;
    netPos.set(id, { x: saved[id][0], y: saved[id][1] });
    fresh.delete(id);
  }
  for (const id of fresh) {
    const anchors = cy
      .getElementById(id)
      .neighborhood('node.item')
      .filter((n) => netPos.has(n.id()) && !fresh.has(n.id()));
    const p = anchors.length
      ? { x: average(anchors.map((n) => netPos.get(n.id())!.x)), y: average(anchors.map((n) => netPos.get(n.id())!.y)) }
      : { x: Math.random() * 400, y: Math.random() * 400 };
    netPos.set(id, { x: p.x + Math.random() * 40 - 20, y: p.y + Math.random() * 40 - 20 });
  }
}

// Lists: one column per node type, sorted by title, with a header box on top.
function listLayout() {
  listPos.clear();
  cy.nodes('.header').remove();
  const byType = new Map<string, NodeSingular[]>();
  items().forEach((n) => push(byType, n.data('type'), n));
  const types = [...byType.keys()].sort((a, b) => byType.get(b)!.length - byType.get(a)!.length || a.localeCompare(b));
  types.forEach((type, col) => {
    const x = col * LIST.colWidth;
    const nodes = byType.get(type)!.sort((a, b) => a.data('title').localeCompare(b.data('title')));
    nodes.forEach((n, row) => listPos.set(n.id(), { x, y: (row + 1) * LIST.rowHeight }));
    if (mode === 'lists')
      cy.add({
        group: 'nodes',
        data: { id: `header:${type}`, label: `${type} (${nodes.length})`, color: colorFor(type), type },
        classes: 'header',
        position: { x, y: -6 },
      });
  });
}

function homeOf(id: string) {
  return (mode === 'lists' ? listPos : netPos).get(id);
}

// Force layout (Cytoscape's built-in "cose"), run once when there is no saved layout.
function runForceLayout() {
  return new Promise<void>((resolve) => {
    // The layout needs the edges too, or it treats every box as unconnected.
    const layout = cy.elements('node.item, edge').layout({
      name: 'cose',
      animate: false,
      nodeRepulsion: () => 40000,
      idealEdgeLength: () => 90,
      numIter: 1500,
      randomize: true,
    });
    layout.one('layoutstop', () => {
      items().forEach((n) => {
        netPos.set(n.id(), { ...n.position() });
      });
      resolve();
    });
    layout.run();
  });
}

// Pulls the starting view together: the top level (and pins) on rings around the middle, biggest
// first, so the nodes with the most under them sit in the center. Everything else moves along with
// the ring node it sits under.
function tidyLayout() {
  if (showEverything) return;
  const onRing = (n: NodeSingular) => isTopLevel(n) || pinned.has(n.id());
  const ringNodeOver = (n: NodeSingular, seen = new Set<string>()): NodeSingular | null => {
    if (onRing(n)) return n;
    if (seen.has(n.id())) return null;
    seen.add(n.id());
    const parent = n.outgoers(underSelector).targets().first() as NodeSingular;
    return parent.nonempty() ? ringNodeOver(parent, seen) : null;
  };
  const ring = items()
    .filter((n) => onRing(n))
    .sort(
      (a, b) => weight(b as NodeSingular) - weight(a as NodeSingular) || a.data('title').localeCompare(b.data('title')),
    );
  // Ring k has room for about 2πk circles; labels sit to the right, so circles need room sideways.
  const RADIUS = 170;
  const SPACING = 230;
  const moves = new Map<string, Point>();
  let i = 0;
  for (let k = 0; i < ring.length; k++) {
    const room = k === 0 ? 1 : Math.floor((2 * Math.PI * k * RADIUS) / SPACING);
    const count = Math.min(room, ring.length - i);
    for (let j = 0; j < count; j++, i++) {
      const angle = -Math.PI / 2 + (j * 2 * Math.PI) / count + (k % 2) * (Math.PI / count);
      const was = netPos.get(ring[i].id()) ?? ring[i].position();
      moves.set(ring[i].id(), { x: Math.cos(angle) * k * RADIUS - was.x, y: Math.sin(angle) * k * RADIUS - was.y });
    }
  }
  items().forEach((n) => {
    const anchor = ringNodeOver(n);
    const move = anchor && moves.get(anchor.id());
    const was = netPos.get(n.id()) ?? n.position();
    if (move) netPos.set(n.id(), { x: was.x + move.x, y: was.y + move.y });
  });
}

// How many nodes sit under a node, at any depth.
const weights = new Map<string, number>();
function weight(n: NodeSingular) {
  let w = weights.get(n.id());
  if (w !== undefined) return w;
  const seen = new Set([n.id()]);
  const queue = [n];
  while (queue.length)
    queue
      .pop()!
      .incomers(underSelector)
      .sources()
      .forEach((c: NodeSingular) => {
        if (seen.has(c.id())) return;
        seen.add(c.id());
        queue.push(c);
      });
  w = seen.size - 1;
  weights.set(n.id(), w);
  return w;
}
// Circle sizes, and whether each label fits inside its circle.
function sizeCircles() {
  weights.clear();
  items().forEach((n) => {
    const d = 14 + Math.sqrt(weight(n)) * 8;
    n.data('d', d);
    n.toggleClass('inside', (n.data('label') as string).length * 6.2 + 8 <= d);
  });
}

let mode: Mode = 'network';
$('layout-toggle').textContent = 'Show as lists';
function setMode(next: Mode, animate = true) {
  restoreGroups(false);
  mode = next;
  $('layout-toggle').textContent = mode === 'network' ? 'Show as lists' : 'Show as network';
  listLayout();
  items().forEach((n) => {
    const to = homeOf(n.id());
    if (!to) return;
    if (animate) n.animate({ position: to, duration: 500 });
    else n.position(to);
  });
  applyFilters();
  if (animate) setTimeout(() => cy.animate({ fit: { eles: cy.nodes(':visible'), padding: 30 }, duration: 300 }), 520);
  if (selected) select(selected, { keepCamera: true });
}
$('layout-toggle').onclick = () => setMode(mode === 'network' ? 'lists' : 'network');

// ---------- Selection ----------

// What is on the graph. By default: top-level nodes and pinned nodes. A node is not top level when it
// belongs under another one: part_of it, a note on it (comments_on), or a candidate for it.
// While something is selected or searched, everything it involves shows too; clearing it goes back
// to the top level.
let pinned = new Set<string>();
let showEverything = false;
let movable = false; // the "Move boxes" checkbox
let resetting = false; // set by Reset view, so the page doesn't save the view on its way out
const underSelector = [...UNDER_EDGES].map((t) => `edge[type = "${t}"]`).join(', ');
function isTopLevel(n: NodeSingular) {
  if (n.data('type') === GHOST_TYPE) return false;
  return n
    .outgoers(underSelector)
    .targets()
    .every((t) => (t as NodeSingular).data('type') === GHOST_TYPE);
}
const onGraph = (n: NodeSingular) =>
  showEverything || mode === 'lists' || pinned.has(n.id()) || !!focus?.has(n.id()) || isTopLevel(n);

let selected: string | null = null;
let hideUnrelated = false;
const hiddenTypes = new Set<string>();
// When set, only these nodes are bright (search matches, a sibling list, a selection).
let focus: Set<string> | null = null;

function applyFilters() {
  cy.batch(() => {
    cy.elements().removeClass('faded gone near focus');
    items().toggleClass('net', mode === 'network');
    items().forEach((n) => {
      if (hiddenTypes.has(n.data('type')) || !onGraph(n)) n.addClass('gone');
      else if (focus && !focus.has(n.id())) n.addClass(hideUnrelated ? 'gone' : 'faded');
    });
    cy.edges().forEach((e) => {
      const ends = [e.source(), e.target()];
      if (ends.some((n) => n.hasClass('gone'))) e.addClass('gone');
      else if (focus && !ends.every((n) => focus!.has(n.id()))) e.addClass(hideUnrelated ? 'gone' : 'faded');
      else if (selected && ends.some((n) => n.id() === selected)) e.addClass('near');
    });
    if (selected) cy.getElementById(selected).addClass('focus');
    cy.nodes('.header').forEach((h) => {
      if (hiddenTypes.has(h.data('type'))) h.addClass('gone');
    });
  });
}

function select(id: string | null, opts: { zoom?: boolean; keepCamera?: boolean } = {}) {
  // Clicking a node that is already in the tree reshapes the tree in place: the clicked node's parent
  // stays where it is (or the node itself, when no parent is on screen), the camera stays put, and the
  // boxes glide to their new spots.
  const inPlace = id !== null && mode === 'network' && !opts.zoom && !!node(id).data('big');
  const was = new Map<string, Point>();
  let anchor: { id: string; at: Point } | null = null;
  if (inPlace) {
    items()
      .filter((m) => !!m.data('big'))
      .forEach((m) => {
        was.set(m.id(), { ...m.position() });
      });
    const pivot = familyGraph.parents(id).find((p) => was.has(p)) ?? id;
    anchor = { id: pivot, at: was.get(pivot)! };
  }
  restoreGroups(false);
  selected = id;
  if (id === null) {
    focus = null;
    applyFilters();
    renderPanel(null);
    updateStats();
    updateGrab();
    if (searchInput.value.trim()) runSearch(false);
    return;
  }
  const nodeId = id;
  const n = cy.getElementById(nodeId);
  focus = new Set([
    nodeId,
    ...n.neighborhood('node.item').map((m) => m.id()),
    ...family(nodeId, familyGraph, GROUP).ids,
  ]);
  applyFilters();
  renderPanel(nodeId);
  updateStats();
  if (mode === 'network') {
    gatherNeighbors(n, !opts.keepCamera && !inPlace, anchor);
    if (inPlace)
      items().forEach((m) => {
        const from = was.get(m.id());
        if (!from) return;
        const to = { ...m.position() };
        m.position(from);
        m.animate({ position: to, duration: 400 });
      });
  } else if (!opts.keepCamera) cy.animate({ center: { eles: n }, zoom: opts.zoom ? 1.2 : cy.zoom(), duration: 400 });
  updateGrab();
}

// The family tree around the selected node (family.ts): one Cytoscape compound node per group.
// Everything moves back when the selection is cleared.
// anchor: keep this node (the selection or one of its parents) where it is on screen.
function gatherNeighbors(n: NodeSingular, moveCamera: boolean, anchor: { id: string; at: Point } | null = null) {
  const { clusters } = family(n.id(), familyGraph, GROUP);
  let center = netPos.get(n.id()) ?? n.position();
  if (anchor) {
    const offset = clusters.flatMap((c) => c.members).find((m) => m.id === anchor.id) ?? { x: 0, y: 0 };
    center = { x: anchor.at.x - offset.x, y: anchor.at.y - offset.y };
  }
  if (!clusters.length) return;
  cy.batch(() => {
    n.data('big', true);
    n.position(center);
    clusters.forEach((c, i) => {
      const parentId = `group:${i}`;
      const color = c.type ? colorFor(c.type) : '#555';
      cy.add({ group: 'nodes', data: { id: parentId, label: c.label, color }, classes: 'group' });
      for (const m of c.members) {
        const member = node(m.id);
        member.move({ parent: parentId });
        member.data('big', true);
        member.position({ x: center.x + m.x, y: center.y + m.y });
      }
    });
  });
  if (moveCamera) fitBeside(n.union(cy.nodes('.group')));
}

// The graph as the family tree sees it (see family.ts).
const familyGraph: FamilyGraph = {
  parents: (id) =>
    node(id)
      .outgoers(underSelector)
      .targets()
      .map((t) => t.id()),
  children: (id) =>
    node(id)
      .incomers(underSelector)
      .sources()
      .map((c) => c.id()),
  neighbors: (id) =>
    node(id)
      .neighborhood('node.item')
      .map((m) => m.id())
      .filter((m) => m !== id),
  title: (id) => node(id).data('title'),
  type: (id) => node(id).data('type'),
  relation: (id, other) =>
    relationText(
      node(id)
        .edgesTo(node(other))
        .map((e) => e.data('type')),
      node(other)
        .edgesTo(node(id))
        .map((e) => e.data('type')),
    ),
  visible: (id) => !hiddenTypes.has(node(id).data('type')),
  underKind: (child, parent) =>
    node(child)
      .edgesTo(node(parent))
      .filter(underSelector)
      .map((e) => e.data('type') as string)[0] ?? '',
};

// The node's place in the hierarchy (part_of and the other UNDER_EDGES). above: every ancestor, root first (depth 0 at the top).
// below: every descendant as an indented tree (depth 0 = direct children), capped so huge trees stay usable.
function hierarchy(id: string, maxBelow = 64) {
  const levels = new Map<string, number>();
  let frontier: NodeSingular[] = [node(id) as NodeSingular];
  for (let level = 1; frontier.length; level++) {
    const next: NodeSingular[] = [];
    for (const n of frontier)
      n.outgoers(underSelector)
        .targets()
        .forEach((parent) => {
          if (parent.id() === id || levels.has(parent.id())) return;
          levels.set(parent.id(), level);
          next.push(parent);
        });
    frontier = next;
  }
  const top = Math.max(0, ...levels.values());
  const above = [...levels]
    .map(([a, level]) => ({ id: a, depth: top - level }))
    .sort((a, b) => a.depth - b.depth || node(a.id).data('title').localeCompare(node(b.id).data('title')));

  const below: { id: string; depth: number }[] = [];
  const seen = new Set([id, ...levels.keys()]);
  const walk = (parent: string, depth: number) => {
    const children = node(parent)
      .incomers(underSelector)
      .sources()
      .filter((c: NodeSingular) => !seen.has(c.id()))
      .sort((a: NodeSingular, b: NodeSingular) => a.data('title').localeCompare(b.data('title')));
    for (const c of children) {
      if (below.length >= maxBelow) return;
      if (seen.has(c.id())) continue;
      seen.add(c.id());
      below.push({ id: c.id(), depth });
      walk(c.id(), depth + 1);
    }
  };
  walk(id, 0);
  return { above, below };
}

// Like cy.fit, but keeps the nodes clear of the detail panel on the right.
function fitBeside(eles: cytoscape.CollectionArgument) {
  const bb = cy.collection(eles).boundingBox();
  const pad = 40;
  const width = cy.width() - ($('panel').hidden ? 0 : 360);
  const zoom = Math.min(1.5, (width - 2 * pad) / bb.w, (cy.height() - 2 * pad) / bb.h);
  const pan = { x: width / 2 - zoom * (bb.x1 + bb.w / 2), y: cy.height() / 2 - zoom * (bb.y1 + bb.h / 2) };
  cy.animate({ zoom, pan, duration: 400, easing: 'ease-out' });
}

// Puts grouped nodes back where they live in the current layout.
function restoreGroups(animate = true) {
  const groups = cy.nodes('.group');
  if (groups.empty()) return;
  cy.batch(() => {
    groups.children().forEach((m) => {
      m.move({ parent: null });
    });
    groups.remove();
    items().forEach((m) => {
      if (!m.data('big')) return;
      m.removeData('big');
      const to = homeOf(m.id());
      if (!to) return;
      if (animate) m.animate({ position: to, duration: 300 });
      else m.position(to);
    });
  });
}

cy.on('tap', 'node.item', (e) => select(e.target.id()));
cy.on('dbltap', 'node.item', (e) => select(e.target.id(), { zoom: true }));
cy.on('tap', (e) => {
  if (e.target === cy) select(null);
});
// With "Move boxes" on, dragging a box in network view moves its home too. The tree around a
// selection is laid out for you, so its boxes don't drag.
function updateGrab() {
  cy.autoungrabify(!movable || cy.nodes('.group').nonempty());
}
cy.on('dragfree', 'node.item', (e) => {
  const n = e.target as NodeSingular;
  if (mode === 'network' && !n.data('big')) netPos.set(n.id(), { ...n.position() });
});

$<HTMLInputElement>('hide-unrelated').onchange = (e) => {
  hideUnrelated = (e.target as HTMLInputElement).checked;
  applyFilters();
};

// ---------- Detail panel ----------

const node = (id: string) => cy.getElementById(id);

function nodeLink(id: string) {
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = node(id).data('title');
  a.style.borderLeft = `4px solid ${node(id).data('color')}`;
  a.onclick = (ev) => {
    ev.preventDefault();
    select(id, { zoom: true });
  };
  return a;
}

function siblings(id: string) {
  return node(id)
    .outgoers(underSelector)
    .edges()
    .map((e) => {
      const parent = e.target();
      const members = parent
        .incomers(underSelector)
        .sources()
        .filter((m: NodeSingular) => m.id() !== id)
        .map((m: NodeSingular) => m.id());
      return { parent: parent.id(), members };
    });
}

function renderPanel(id: string | null) {
  const panel = $('panel');
  panel.replaceChildren();
  panel.hidden = id === null;
  if (id === null) return;

  const n = node(id);
  const raw = n.data('raw') as ExportedNode | null;
  const typeLine = el('div', '', 'type-line');
  typeLine.append(typeBadge('node', n.data('type')), el('code', id.replace(/^default:/, '')));
  panel.append(el('h2', n.data('title')), typeLine);
  // Breadcrumb up the hierarchy: root › … › parent.
  const { above } = hierarchy(id, 0);
  if (above.length) {
    const path = el('div', '', 'path');
    above.forEach((a) => path.append(nodeLink(a.id), el('span', '›')));
    panel.append(path);
  }
  if (raw?.summary) panel.append(el('p', raw.summary, 'summary'));
  if (raw?.body) {
    const details = el('details');
    details.append(el('summary', 'Full text'), el('pre', raw.body));
    panel.append(details);
  }
  if (raw && Object.keys(raw.properties).length) {
    const dl = el('dl');
    for (const [k, v] of Object.entries(raw.properties))
      dl.append(el('dt', k), el('dd', typeof v === 'string' ? v : JSON.stringify(v)));
    panel.append(dl);
  }
  if (!raw)
    panel.append(
      el(
        'p',
        'Ghost node: an edge points here, but the node is not in this graph (not loaded, or not written yet).',
        'summary',
      ),
    );

  const groups = new Map<string, string[]>();
  n.outgoers('edge').forEach((e) => push(groups, `${e.data('type')} →`, e.target().id()));
  n.incomers('edge').forEach((e) => push(groups, `← ${e.data('type')}`, e.source().id()));
  if (groups.size) panel.append(el('h3', `Connections (${n.connectedEdges().length})`));
  for (const [label, ids] of groups) {
    const title = el('div', '', 'group-title');
    title.append(typeBadge('edge', label.replace(/[←→ ]/g, ''), label));
    const list = el('ul');
    ids.forEach((m) => list.append(li(nodeLink(m))));
    panel.append(title, list);
  }

  for (const { parent, members } of siblings(id)) {
    const title = el('h3', 'Siblings in ');
    title.append(nodeLink(parent));
    const show = el('button', 'Show on graph');
    show.onclick = () => {
      focus = new Set([id, parent, ...members]);
      applyFilters();
    };
    const list = el('ul');
    members.slice(0, 50).forEach((m) => list.append(li(nodeLink(m))));
    if (members.length > 50) list.append(li(el('span', `…and ${members.length - 50} more`)));
    panel.append(title, show, list);
  }
}

// ---------- Search ----------

const searchInput = $<HTMLInputElement>('search');
const results = $('results');
// The search stays in the box while you look at results: clearing a selection brings its matches back.
function runSearch(showList = true) {
  const q = searchInput.value.trim().toLowerCase();
  results.replaceChildren();
  if (!q) {
    select(selected);
    return;
  }
  const matches = items()
    .filter((n) => `${n.data('title')} ${n.id()} ${n.data('raw')?.summary ?? ''}`.toLowerCase().includes(q))
    .map((n) => n.id());
  restoreGroups();
  selected = null;
  focus = new Set(matches);
  applyFilters();
  updateStats();
  matches.slice(0, 20).forEach((id) => {
    const a = nodeLink(id);
    a.addEventListener('click', () => results.replaceChildren());
    if (showList) results.append(li(a));
  });
  if (!matches.length && showList) results.append(li(el('span', 'No matches')));
}
searchInput.oninput = () => runSearch();
searchInput.onfocus = () => !selected && searchInput.value.trim() && runSearch();
searchInput.onkeydown = (e) => {
  if (e.key === 'Enter') (results.querySelector('a') as HTMLAnchorElement | null)?.click();
  if (e.key === 'Escape') {
    searchInput.value = '';
    results.replaceChildren();
    select(null);
  }
};

// ---------- Legend ----------

function renderLegend() {
  const nodeList = $('legend-nodes');
  nodeList.replaceChildren();
  for (const [type, count] of countBy(items().map((n) => n.data('type')))) {
    const row = el('li');
    const toggle = el('label');
    const box = el('input') as HTMLInputElement;
    box.type = 'checkbox';
    box.checked = !hiddenTypes.has(type);
    box.onchange = () => {
      box.checked ? hiddenTypes.delete(type) : hiddenTypes.add(type);
      applyFilters();
    };
    const dot = el('span', '', 'dot');
    dot.style.background = colorFor(type);
    toggle.append(box, dot, el('span', `${type} (${count})`));
    row.append(toggle, helpButton('node', type));
    nodeList.append(row);
  }
  const edgeList = $('legend-edges');
  edgeList.replaceChildren();
  for (const [type, count] of countBy(cy.edges().map((e) => e.data('type')))) {
    const row = el('li');
    row.append(el('span', `${type} (${count})`), helpButton('edge', type));
    edgeList.append(row);
  }
}

function typeBadge(kind: 'node' | 'edge', type: string, text = type) {
  const badge = el('span', '', 'badge');
  if (kind === 'node') badge.style.background = colorFor(type);
  badge.append(el('span', text), helpButton(kind, type));
  return badge;
}

function helpButton(kind: 'node' | 'edge', type: string) {
  const b = el('button', '?', 'help');
  b.title = help(kind, type);
  b.onclick = (ev) => {
    ev.stopPropagation();
    const pop = $('help-pop');
    pop.replaceChildren(el('strong', `${type} (${kind} type)`), el('p', help(kind, type)));
    const r = b.getBoundingClientRect();
    pop.style.left = `${Math.min(r.left, innerWidth - 300)}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.hidden = false;
  };
  return b;
}
document.addEventListener('click', () => ($('help-pop').hidden = true));

function updateStats() {
  const showing = items().filter((n) => !n.hasClass('gone')).length;
  const total = items().length;
  $('stats').textContent =
    `${showing === total ? '' : `${showing.toLocaleString()} of `}${total.toLocaleString()} nodes · ` +
    (live() ? `live · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : dataUrl);
}

// ---------- Remembering the view across reloads ----------

interface SavedState {
  positions: Record<string, [number, number]>;
  mode: Mode;
  selected: string | null;
  hideUnrelated: boolean;
  hiddenTypes: string[];
  showEverything?: boolean;
  movable?: boolean;
  camera: { zoom: number; pan: Point };
}
const stateKey = () => `mcpedia-viewer:v2:cytoscape:${fileParam ?? 'live'}`;
function loadState(): SavedState | null {
  try {
    return JSON.parse(localStorage.getItem(stateKey()) ?? 'null');
  } catch {
    return null;
  }
}
function saveState() {
  if (resetting) return;
  const positions: SavedState['positions'] = {};
  for (const [id, p] of netPos) positions[id] = [p.x, p.y];
  const state: SavedState = {
    positions,
    mode,
    selected,
    hideUnrelated,
    hiddenTypes: [...hiddenTypes],
    showEverything,
    movable,
    camera: { zoom: cy.zoom(), pan: cy.pan() },
  };
  try {
    localStorage.setItem(stateKey(), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the view just won't be remembered.
  }
}
addEventListener('pagehide', saveState);

// ---------- Startup ----------

const saved = loadState();
const firstAdded = applyData(await fetchGraph());
if (firstAdded.some((id) => !saved?.positions[id])) {
  await runForceLayout();
  tidyLayout();
  // Keep whatever positions were saved, so a few new nodes don't reshuffle everything.
  for (const [id, [x, y]] of Object.entries(saved?.positions ?? {})) if (netPos.has(id)) netPos.set(id, { x, y });
} else placeNewNodes(firstAdded, saved!.positions);
listLayout();
items().forEach((n) => {
  n.position(netPos.get(n.id())!);
});
renderLegend();
updateStats();

if (saved) {
  hideUnrelated = saved.hideUnrelated;
  $<HTMLInputElement>('hide-unrelated').checked = hideUnrelated;
  saved.hiddenTypes.forEach((t) => hiddenTypes.add(t));
  showEverything = saved.showEverything ?? false;
  $<HTMLInputElement>('show-all').checked = showEverything;
  movable = saved.movable ?? false;
  $<HTMLInputElement>('movable').checked = movable;
  renderLegend();
  if (saved.mode !== mode) setMode(saved.mode, false);
  if (saved.selected && node(saved.selected).nonempty()) select(saved.selected, { keepCamera: true });
  applyFilters();
  cy.viewport({ zoom: saved.camera.zoom, pan: saved.camera.pan });
} else {
  applyFilters();
  cy.fit(cy.nodes(':visible'), 30);
}
updateGrab();
updateStats();

$<HTMLInputElement>('show-all').onchange = (e) => {
  showEverything = (e.target as HTMLInputElement).checked;
  applyFilters();
  updateStats();
};
$<HTMLInputElement>('movable').onchange = (e) => {
  movable = (e.target as HTMLInputElement).checked;
  updateGrab();
};
// Reset view forgets everything this page remembers (selection, filters, moved boxes, camera) and
// starts fresh. The data itself is untouched.
$('reset-view').onclick = () => {
  resetting = true;
  try {
    localStorage.removeItem(stateKey());
  } catch {
    // Nothing saved to forget.
  }
  location.reload();
};
// Collapse clears the selection and tidies the starting view.
$('collapse').title = 'Clear the selection and tidy the starting layout';
$('show-all').parentElement!.title = 'Off: only top-level and pinned nodes, plus the selection and search matches';
$('collapse').onclick = () => {
  searchInput.value = '';
  results.replaceChildren();
  select(null);
  if (mode !== 'network') return;
  tidyLayout();
  items().forEach((n) => {
    n.position(netPos.get(n.id())!);
  });
  cy.animate({ fit: { eles: cy.nodes(':visible'), padding: 30 }, duration: 300 });
};

// ---------- Refresh and live updates ----------
// Same behavior as the Sigma version: merge in place, keep selection, search, filters and camera.

let refreshing = false;
async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await fetchGraph();
    const keepSelected = selected;
    const viewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    restoreGroups(false);
    const added = applyData(data);
    placeNewNodes(added, {});
    listLayout();
    items().forEach((n) => {
      n.position(homeOf(n.id())!);
    });
    renderLegend();
    updateStats();
    if (keepSelected && node(keepSelected).nonempty()) select(keepSelected, { keepCamera: true });
    else select(null);
    if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
    cy.viewport(viewport);
  } finally {
    refreshing = false;
  }
}
$<HTMLButtonElement>('refresh').onclick = () => refreshData();
// Live data reloads itself when the graph changes, so the button is only for snapshots.
if (live()) $('refresh').style.display = 'none';

if (live()) {
  let lastVersion = await fetch('api/version').then((r) => r.text());
  setInterval(async () => {
    if (document.hidden || refreshing) return;
    const version = await fetch('api/version', { cache: 'no-store' })
      .then((r) => r.text())
      .catch(() => lastVersion);
    if (version !== lastVersion) {
      lastVersion = version;
      await refreshData();
    }
  }, 3000);
}

Object.assign(window, { cy, select, refreshData, saveState });

// ---------- Helpers ----------

function el(tag: string, text = '', className = '') {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function li(child: HTMLElement) {
  const item = el('li');
  item.append(child);
  return item;
}
function push<T>(map: Map<string, T[]>, key: string, value: T) {
  map.set(key, [...(map.get(key) ?? []), value]);
}
function average(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function countBy(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
