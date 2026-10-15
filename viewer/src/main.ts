// MCPedia graph viewer (prototype): Sigma.js v4 renders, graphology holds the data.
// Everything the user sees besides the graph itself (search, panel, legend) is plain DOM.
import { MultiDirectedGraph, UndirectedGraph } from 'graphology';
import Sigma from 'sigma';
import { sdfCircle, sdfRectangle } from 'sigma/rendering';
import { animateNodes } from 'sigma/utils';
import circular from 'graphology-layout/circular';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { describeType } from './descriptions';
import { family, SIZES, UNDER_EDGES, type FamilyGraph } from './family';

// ---------- Data ----------

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
interface ExportedEdge {
  from: string;
  to: string;
  type: string;
  note?: string | null;
}
interface ExportedGraph {
  source: string;
  typeDefs: { kind: string; name: string; description: string | null }[];
  nodes: ExportedNode[];
  edges: ExportedEdge[];
  pinned?: string[];
  version?: string; // the database version, from the live server
}

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

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Data comes from the live server (`npm start`, which reads the database) or from a file (`?data=...`).
const fileParam = new URLSearchParams(location.search).get('data');
let dataUrl = fileParam ?? 'api/graph';
async function fetchGraph(): Promise<ExportedGraph> {
  const r = await fetch(dataUrl, { cache: 'no-store' });
  if (r.ok) return r.json();
  if (!fileParam && dataUrl === 'api/graph') {
    // Not served by `npm start`: fall back to the exported file.
    dataUrl = 'data/mcpedia.json';
    return fetchGraph();
  }
  throw new Error(`Could not load ${dataUrl} (${r.status}). Run "npm start", or "npm run export" then "npm run dev".`);
}
const live = () => dataUrl === 'api/graph';
// The database version of the data on screen. It only moves once a load succeeds,
// so a refresh that fails is retried on the next poll.
let loadedVersion = '';
async function pollVersion() {
  if (document.hidden || refreshing) return;
  const version = await fetch('api/version', { cache: 'no-store' })
    .then((r) => r.text())
    .catch(() => loadedVersion);
  if (version !== loadedVersion) await refreshData().catch((err) => console.warn('Refresh failed, retrying', err));
}

const graph = new MultiDirectedGraph();
const typeColor = new Map<string, string>();
const colorFor = (type: string) => {
  if (type === GHOST_TYPE) return '#999';
  if (!typeColor.has(type)) typeColor.set(type, PALETTE[typeColor.size % PALETTE.length]);
  return typeColor.get(type)!;
};

// Box labels are cut short so they fit; the full title is in the detail panel.
const shortLabel = (text: string) => (text.length > 26 ? `${text.slice(0, 25)}…` : text);

const typeDefs = new Map<string, string | null>();
// Pinned "start here" nodes (the `pinned` setting); always on the graph.
let pinned = new Set<string>();
// How many nodes sit under each node (see weight()); cleared when the data changes.
let weights = new Map<string, number>();
let movable = false; // the "Move boxes" checkbox
let resetting = false; // set by Reset view, so the page doesn't save the view on its way out
const help = (kind: 'node' | 'edge', name: string) => typeDefs.get(`${kind}:${name}`) ?? describeType(kind, name);

// Loads data into the graph, keeping every node that already exists where it is.
// Returns the nodes that are new, so they can be given positions.
function applyData(data: ExportedGraph) {
  typeDefs.clear();
  for (const t of data.typeDefs) typeDefs.set(`${t.kind}:${t.name}`, t.description);
  // Most common types get the first (most distinct) colors.
  [...countBy(data.nodes.map((n) => n.type)).keys()].forEach(colorFor);

  const added: string[] = [];
  const keep = new Set<string>();
  const upsert = (id: string, attrs: Record<string, unknown>) => {
    keep.add(id);
    if (graph.hasNode(id)) graph.mergeNodeAttributes(id, attrs);
    else {
      // Placeholder position; placeNewNodes sets the real one.
      graph.addNode(id, { x: 0, y: 0, size: 5, ...attrs });
      added.push(id);
    }
  };
  for (const n of data.nodes) {
    upsert(n.id, {
      label: shortLabel(n.title || n.key),
      title: n.title || n.key,
      nodeType: n.type,
      color: colorFor(n.type),
      raw: n,
    });
  }
  graph.clearEdges();
  for (const e of data.edges) {
    // Edges are late-bound (ADR 0007): the target may not be loaded yet. Show it as a grey ghost node.
    for (const end of [e.from, e.to]) {
      if (!keep.has(end)) {
        const key = end.replace(/^default:/, '');
        upsert(end, {
          label: shortLabel(key),
          title: key,
          nodeType: GHOST_TYPE,
          color: colorFor(GHOST_TYPE),
          raw: null,
        });
      }
    }
    graph.addEdge(e.from, e.to, { edgeType: e.type, note: e.note ?? null });
  }
  graph.forEachNode((id) => {
    if (keep.has(id)) return;
    graph.dropNode(id);
    moved.delete(id);
  });
  pinned = new Set(data.pinned ?? []);
  weights = new Map();
  return added;
}

// ---------- Layouts ----------
// "Network" (default): force-directed. "Lists": one vertical column per node type, sorted by title.
// Each layout keeps its own positions so switching back and forth is instant.

type Mode = 'lists' | 'network';
let mode: Mode = 'network';

// Box size in graph units for list mode. Sizes are half-widths; boxes are BOX_ASPECT times wider than tall.
const BOX_ASPECT = 8;
const BOX_SIZE = 180;
const ROW_GAP = 56;
const COLUMN_GAP = 420;
const MAX_ROWS = 60; // long types wrap into extra columns
const columns: { type: string; x: number; y: number }[] = [];

function listLayout() {
  columns.length = 0;
  const byType = new Map<string, string[]>();
  graph.forEachNode((id, a) => push(byType, a.nodeType as string, id));
  let col = 0;
  for (const type of countBy(graph.mapNodes((_id, a) => a.nodeType as string)).keys()) {
    const ids = byType
      .get(type)!
      .sort((a, b) => (graph.getNodeAttribute(a, 'title') as string).localeCompare(graph.getNodeAttribute(b, 'title')));
    columns.push({ type, x: col * COLUMN_GAP, y: ROW_GAP });
    ids.forEach((id, i) => {
      const x = (col + Math.floor(i / MAX_ROWS)) * COLUMN_GAP;
      const y = -(i % MAX_ROWS) * ROW_GAP; // sigma's y axis points up, so rows go down
      graph.mergeNodeAttributes(id, { listX: x, listY: y });
    });
    col += Math.ceil(ids.length / MAX_ROWS);
  }
}

// New nodes start next to their already-placed neighbors, so an update doesn't reshuffle the view.
function placeNewNodes(added: string[], saved: Record<string, [number, number]>) {
  const fresh = new Set(added);
  let unplaced = 0;
  for (const id of added) {
    const known = saved[id];
    if (known) {
      graph.mergeNodeAttributes(id, { netX: known[0], netY: known[1] });
      fresh.delete(id);
    }
  }
  for (const id of fresh) {
    const anchors = graph.neighbors(id).filter((n) => !fresh.has(n));
    if (!anchors.length) unplaced++;
    const [x, y] = anchors.length
      ? [
          average(anchors.map((n) => graph.getNodeAttribute(n, 'netX'))),
          average(anchors.map((n) => graph.getNodeAttribute(n, 'netY'))),
        ]
      : [Math.random() * 100, Math.random() * 100];
    graph.mergeNodeAttributes(id, { netX: x + Math.random() * 4 - 2, netY: y + Math.random() * 4 - 2 });
  }
  return unplaced;
}

const saved = loadState();
const firstData = await fetchGraph();
loadedVersion = firstData.version ?? '';
const firstAdded = applyData(firstData);
// Without a saved layout, start on a circle and let the force layout spread things out.
// Small graphs are laid out right away; big ones settle in a background worker.
const needsLayout = firstAdded.some((id) => !saved?.positions[id]);
const layoutNow = needsLayout && graph.order <= 3000;
// Positions the user had, put back over a fresh layout so a few new nodes don't reshuffle everything.
const restoreSaved = () => {
  for (const [id, [x, y]] of Object.entries(saved?.positions ?? {}))
    if (graph.hasNode(id)) graph.mergeNodeAttributes(id, { netX: x, netY: y });
};
if (needsLayout) {
  circular.assign(graph);
  if (layoutNow) forceAtlas2.assign(graph, { iterations: 500, settings: forceAtlas2.inferSettings(graph) });
  graph.forEachNode((id, a) => graph.mergeNodeAttributes(id, { netX: a.x, netY: a.y }));
  restoreSaved();
} else placeNewNodes(firstAdded, saved?.positions ?? {});
graph.forEachNode((id, a) => graph.mergeNodeAttributes(id, { x: a.netX, y: a.netY }));
listLayout();
const layout = new FA2Layout(graph, {
  settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 2000 },
});
let networkSettled = !needsLayout || layoutNow;

const layoutButton = $<HTMLButtonElement>('layout-toggle');
function setMode(next: Mode) {
  restoreGroups(false);
  if (mode === 'network') {
    layout.stop();
    graph.forEachNode((id, a) => graph.mergeNodeAttributes(id, { netX: a.x, netY: a.y }));
  }
  mode = next;
  const [kx, ky] = mode === 'lists' ? ['listX', 'listY'] : ['netX', 'netY'];
  graph.forEachNode((id, a) =>
    graph.mergeNodeAttributes(id, {
      x: a[kx],
      y: a[ky],
      // Network boxes are small pills sized by connection count; list boxes are wide enough for a label.
      size: mode === 'lists' ? BOX_SIZE : 5 + Math.sqrt(graph.degree(id)) * 2.5,
      aspectRatio: mode === 'lists' ? BOX_ASPECT : 2.2,
    }),
  );
  // Lists: boxes scale with zoom and labels show once the box is big enough to hold them.
  // Boxes never overlap there, so labels can be dense.
  renderer?.setSettings(
    mode === 'lists'
      ? { itemSizesReference: 'positions', labelRenderedSizeThreshold: 60, labelDensity: 10 }
      : { itemSizesReference: 'screen', labelRenderedSizeThreshold: 8, labelDensity: 1 },
  );
  layoutButton.textContent = mode === 'lists' ? 'Show as network' : 'Show as lists';
  if (mode === 'network' && !networkSettled) {
    // First visit: let the force layout settle, then stop so the CPU goes quiet.
    networkSettled = true;
    layout.start();
    setTimeout(
      () => {
        if (mode !== 'network') return;
        layout.stop();
        saveState();
      },
      Math.min(4000 + graph.order / 5, 20000),
    );
  }
  frameShown();
  if (renderer) mode === 'lists' ? fitLists() : renderer.getCamera().reset({ duration: 300 });
  updateHeaders();
}
// Start list mode zoomed in far enough that box labels fit, anchored at the top-left column.
function fitLists() {
  const camera = renderer!.getCamera();
  camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  const halfWidthPx = renderer!.graphToViewport({ x: BOX_SIZE, y: 0 }).x - renderer!.graphToViewport({ x: 0, y: 0 }).x;
  const ratio = Math.min(1, halfWidthPx / 115);
  if (ratio < 1) {
    const corner = renderer!.graphToViewport({ x: columns[0].x - BOX_SIZE, y: ROW_GAP * 2 });
    camera.setState(renderer!.getViewportZoomedState(corner, ratio));
  }
}
layoutButton.onclick = () => setMode(mode === 'lists' ? 'network' : 'lists');

// ---------- View state ----------

// What is on the graph. By default: top-level nodes and pinned nodes. A node is not top level when it
// belongs under another one: part_of it, a note on it (comments_on), or a candidate for it.
// Selecting a node opens it: it, its parents and its direct parts stay on the graph afterwards.
// While something is selected or searched, everything it involves shows too.
let showEverything = false;
function isUnder(e: string) {
  return UNDER_EDGES.has(graph.getEdgeAttribute(e, 'edgeType') as string);
}
// The graph as the family tree sees it (see family.ts).
const familyGraph: FamilyGraph = {
  parents: (id) =>
    graph
      .outEdges(id)
      .filter(isUnder)
      .map((e) => graph.target(e)),
  children: (id) =>
    graph
      .inEdges(id)
      .filter(isUnder)
      .map((e) => graph.source(e)),
  neighbors: (id) => graph.neighbors(id).filter((n) => n !== id),
  title: (id) => title(id),
  type: (id) => graph.getNodeAttribute(id, 'nodeType') as string,
  relation: (id, other) => edgeTypesBetween(id, [other]),
  visible: (id) => !hiddenTypes.has(graph.getNodeAttribute(id, 'nodeType') as string),
  underKind: (child, parent) =>
    (graph
      .edges(child, parent)
      .filter(isUnder)
      .map((e) => graph.getEdgeAttribute(e, 'edgeType'))[0] as string) ?? '',
};
function isTopLevel(id: string) {
  if (graph.getNodeAttribute(id, 'nodeType') === GHOST_TYPE) return false;
  return !graph.someOutEdge(
    id,
    (_e, a, _s, target) =>
      UNDER_EDGES.has(a.edgeType as string) && graph.getNodeAttribute(target, 'nodeType') !== GHOST_TYPE,
  );
}
const onGraph = (id: string) =>
  showEverything || mode === 'lists' || pinned.has(id) || focus?.has(id) || isTopLevel(id);
// Pulls the starting view together: the top level (and pins) on rings around the middle, biggest
// first, so the nodes with the most under them sit in the center. Everything else on the graph moves
// along with the ring node it sits under.
function tidyLayout() {
  if (showEverything) return;
  const onRing = (id: string) => isTopLevel(id) || pinned.has(id);
  const ringNodeOver = (id: string, seen = new Set<string>()): string | null => {
    if (onRing(id)) return id;
    if (seen.has(id)) return null;
    seen.add(id);
    const parent = graph.findOutNeighbor(id, (p) => graph.someEdge(id, p, (e) => isUnder(e)));
    return parent ? ringNodeOver(parent, seen) : null;
  };
  const ring = graph
    .filterNodes((id) => onRing(id))
    .sort((a, b) => weight(b) - weight(a) || title(a).localeCompare(title(b)));
  // Ring k has room for about 2πk boxes; labels sit to the right, so boxes need room sideways.
  const RADIUS = 110;
  const SPACING = 150;
  const placed = new Map<string, { x: number; y: number }>();
  let i = 0;
  for (let k = 0; i < ring.length; k++) {
    const room = k === 0 ? 1 : Math.floor((2 * Math.PI * k * RADIUS) / SPACING);
    const count = Math.min(room, ring.length - i);
    for (let j = 0; j < count; j++, i++) {
      const angle = -Math.PI / 2 + (j * 2 * Math.PI) / count + (k % 2) * (Math.PI / count);
      placed.set(ring[i], { x: Math.cos(angle) * k * RADIUS, y: Math.sin(angle) * k * RADIUS });
    }
  }
  const moves = new Map<string, { dx: number; dy: number }>();
  for (const [id, pos] of placed) {
    const a = graph.getNodeAttributes(id);
    moves.set(id, { dx: pos.x - a.netX, dy: pos.y - a.netY });
  }
  graph.forEachNode((id, a) => {
    const anchor = ringNodeOver(id);
    const move = anchor && moves.get(anchor);
    if (move) graph.mergeNodeAttributes(id, { netX: a.netX + move.dx, netY: a.netY + move.dy });
  });
}

// How many nodes sit under a node, at any depth.
function weight(id: string) {
  let w = weights.get(id);
  if (w !== undefined) return w;
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    for (const e of graph.inEdges(queue.pop()!)) {
      const child = graph.source(e);
      if (isUnder(e) && !seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  w = seen.size - 1;
  weights.set(id, w);
  return w;
}

// Frames the camera on what is on the graph, not on hidden nodes far away.
function frameShown() {
  if (!renderer) return;
  if (showEverything || mode !== 'network') return renderer.setCustomBBox(null);
  const xs: number[] = [];
  const ys: number[] = [];
  graph.forEachNode((id, a) => {
    if (!onGraph(id)) return;
    xs.push(a.netX);
    ys.push(a.netY);
  });
  if (xs.length)
    renderer.setCustomBBox({ x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] });
}

let selected: string | null = null;
let focus: Set<string> | null = null; // nodes to keep bright: the selection and its neighbors, or search matches
let hideUnrelated = false;
const hiddenTypes = new Set<string>();

// Tidy neighbor groups (see gatherNeighbors): box sizes in screen pixels, and where moved nodes came from.
const GROUP = SIZES;
const moved = new Map<string, { x: number; y: number; size: number; aspectRatio: number }>();
let cancelAnimation: (() => void) | null = null;
let treeAnchor: { x: number; y: number } | null = null; // where the selected node sits in the tree
let groupHeaders: { text: string; color: string; x: number; y: number }[] = [];

let renderer: Sigma | undefined;
let defaultZoomToSize: ((ratio: number) => number) | undefined; // node sizing outside the tree
const MIN_CIRCLE = 7;
const LABEL_CHAR_PX = 6.6; // average width of a 12px label character
const labelWidth = (label: string) => label.length * LABEL_CHAR_PX;
const radiusPx = (size: number) => (renderer ? renderer.scaleSize(size) : size);
const labelFits = (label: string, size: number) => 2 * radiusPx(size) >= labelWidth(label) + 10;
if (layoutNow) {
  tidyLayout();
  restoreSaved();
  graph.forEachNode((id, a) => graph.mergeNodeAttributes(id, { x: a.netX, y: a.netY }));
}
setMode('network');
renderer = new Sigma(graph, $('graph'), {
  primitives: {
    nodes: {
      shapes: [
        sdfRectangle({ aspectRatio: { attribute: 'aspectRatio', default: 2.2 }, cornerRadius: 0.35 }),
        sdfCircle(),
      ],
    },
  },
  settings: { renderEdgeLabels: true, labelRenderedSizeThreshold: 8, labelDensity: 1, itemSizesReference: 'screen' },
  nodeReducer: (node, display, attrs) => {
    const out: Record<string, unknown> = {
      shape: 'rectangle',
      labelPosition: 'over',
      labelColor: '#fff',
      labelSize: 12,
    };
    // Network mode: circles, with the label beside them, except in the tidy groups around a selection.
    const circle = mode === 'network' && !moved.has(node);
    if (circle) Object.assign(out, { shape: 'circle', labelPosition: 'right', labelColor: '#222' });
    if (hiddenTypes.has(attrs.nodeType as string) || !onGraph(node)) return { visibility: 'hidden' };
    if (focus && !focus.has(node)) {
      if (hideUnrelated) return { visibility: 'hidden' };
      out.color = '#e4e4e4';
      out.labelColor = '#aaa';
      if (selected) out.label = null; // keep the background quiet around a selection
      out.zIndex = 0;
    } else if (focus) {
      out.zIndex = 1;
      out.labelVisibility = 'visible';
    } else if (!showEverything && mode === 'network' && (pinned.has(node) || isTopLevel(node))) {
      // Only the top level is on the graph, so there is room to label all of it. Its boxes are
      // sized by how much sits under them.
      out.labelVisibility = 'visible';
      if (circle) out.size = 4 + Math.sqrt(weight(node)) * 3;
    }
    if (circle) {
      // Never too small to click. Once a circle is wide enough for its label, the label goes inside.
      const size = Math.max(MIN_CIRCLE, (out.size as number | undefined) ?? display.size);
      out.size = node === selected ? size * 1.4 : size;
      if (labelFits(attrs.label as string, out.size as number))
        Object.assign(out, { labelPosition: 'over', labelColor: '#fff' });
    }
    if (node === selected) out.highlighted = true;
    return out;
  },
  edgeReducer: (edge, _display, attrs) => {
    const [source, target] = graph.extremities(edge);
    if (
      hiddenTypes.has(graph.getNodeAttribute(source, 'nodeType')) ||
      hiddenTypes.has(graph.getNodeAttribute(target, 'nodeType')) ||
      !onGraph(source) ||
      !onGraph(target)
    ) {
      return { visibility: 'hidden' };
    }
    // Lists stay readable by drawing edges only for the selected item.
    if (!focus) return mode === 'lists' ? { visibility: 'hidden' } : { label: null };
    const touchesSelection = selected !== null && (source === selected || target === selected);
    // Edge labels only while they stay readable; the panel always lists the relationship types.
    // Around a grouped selection the group headers name the relationships, so edges stay unlabeled.
    if (touchesSelection)
      return { label: moved.size ? null : (attrs.edgeType as string), color: '#888', size: 1.5, zIndex: 1 };
    if (hideUnrelated || mode === 'lists' || !(focus.has(source) && focus.has(target))) return { visibility: 'hidden' };
    return { label: null, color: '#eee' };
  },
});

const refresh = () => renderer!.refresh({ skipIndexation: true });

// Column headers for list mode, kept in place over the canvas as the camera moves.
function updateHeaders() {
  const box = $('col-headers');
  if (renderer && mode === 'network') {
    // Labels over each tidy neighbor group: node type and how it relates to the selection.
    return box.replaceChildren(
      ...groupHeaders.map((g) => {
        const { x, y } = renderer!.graphToViewport(g);
        const h = el('div', g.text, 'group-header');
        h.style.transform = `translate(${x}px, ${y}px) translate(0, -100%)`;
        h.style.color = g.color;
        return h;
      }),
    );
  }
  if (!renderer || mode !== 'lists') return box.replaceChildren();
  box.replaceChildren(
    ...columns
      .filter((c) => !hiddenTypes.has(c.type))
      .map((c) => {
        const { x, y } = renderer!.graphToViewport({ x: c.x, y: c.y });
        // Headers stick to the top edge when you scroll down a long column.
        const h = el('div', c.type, 'col-header');
        h.style.transform = `translate(${x}px, ${Math.max(y, 30)}px) translate(-50%, -100%)`;
        h.style.borderColor = colorFor(c.type);
        return h;
      }),
  );
}
defaultZoomToSize = renderer.getSetting('zoomToSizeRatioFunction');
renderer.on('afterRender', updateHeaders);
frameShown();
if ((mode as Mode) === 'lists') fitLists();
updateHeaders();

// ---------- Selection, drill-in and siblings ----------

function select(node: string | null, opts: { zoom?: boolean; keepCamera?: boolean } = {}) {
  // Clicking a node that is already in the tree reshapes the tree in place (see gatherNeighbors).
  // Switching to a node outside it snaps the old tree home; clearing animates it home.
  const inPlace = node !== null && mode === 'network' && moved.has(node) && !opts.zoom;
  if (!inPlace) restoreGroups(node === null);
  selected = node;
  if (node === null) {
    focus = null;
    renderPanel(null);
    if (searchInput.value.trim()) return runSearch(false);
  } else {
    focus = new Set([node, ...graph.neighbors(node), ...family(node, familyGraph, GROUP).ids]);
    renderPanel(node);
    if (opts.zoom) zoomTo(node);
    if (inPlace) gatherNeighbors(node, true, false, true);
    else gatherNeighbors(node, !opts.keepCamera, !opts.zoom && !opts.keepCamera);
  }
  refresh();
  updateStats();
}

// ---------- Tidy neighbor groups (network mode) ----------
// When a node is selected, its family moves around it like a family tree (see family.ts):
// ancestors above, siblings beside, descendants below, other neighbors on the far sides.
// It is laid out in screen pixels at the zoom it was opened at, then zooms like a picture.
// Clearing the selection puts every node back.

// inPlace: the node is already in the tree, so keep what can stay put. The new tree is lined up on
// the node's first parent if that is on screen (so going down or sideways only moves the parts
// that change), or else on the node itself, and the camera stays where it is.
function gatherNeighbors(node: string, animate: boolean, center = false, inPlace = false) {
  if (mode !== 'network' || !renderer) return;
  layout.stop();
  const r = renderer;
  // Freeze the framing while nodes move, so the view doesn't jump when the groups widen the graph.
  if (!moved.size) {
    r.setSetting('autoRescale', 'once');
    r.refresh();
  }
  // Convert pixel offsets around the selected node into graph coordinates.
  const origin = r.viewportToGraph({ x: 0, y: 0 });
  const perPxX = (r.viewportToGraph({ x: 100, y: 0 }).x - origin.x) / 100;
  const perPxY = (r.viewportToGraph({ x: 0, y: 100 }).y - origin.y) / 100;
  const sizeFor = (halfWidthPx: number) => halfWidthPx / r.scaleSize(1);
  // While the tree is up, boxes scale with the zoom like everything else, so zooming in magnifies it.
  r.setSetting('zoomToSizeRatioFunction', (ratio) => ratio);

  const { clusters } = family(node, familyGraph, GROUP);
  cancelAnimation?.();
  if (inPlace) {
    const at = (id: string) => graph.getNodeAttributes(id) as { x: number; y: number };
    const pivot = familyGraph.parents(node).find((p) => moved.has(p));
    const offset = pivot && clusters.flatMap((c) => c.members).find((m) => m.id === pivot);
    treeAnchor =
      pivot && offset
        ? { x: at(pivot).x - offset.x * perPxX, y: at(pivot).y - offset.y * perPxY }
        : { x: at(node).x, y: at(node).y };
  } else if (!treeAnchor) {
    const home = moved.get(node) ?? graph.getNodeAttributes(node);
    treeAnchor = { x: home.x, y: home.y };
  }
  const base = treeAnchor;
  const toGraph = (dx: number, dy: number) => ({ x: base.x + dx * perPxX, y: base.y + dy * perPxY });
  const targets: Record<string, { x: number; y: number }> = {};
  groupHeaders = [];
  for (const c of clusters) {
    const color = c.type ? colorFor(c.type) : '#555';
    groupHeaders.push({ text: c.label, color, ...toGraph(c.left, c.top - 4) });
    for (const m of c.members) {
      targets[m.id] = toGraph(m.x, m.y);
      moveNode(m.id, sizeFor(GROUP.boxWidth / 2));
    }
  }
  moveNode(node, sizeFor(GROUP.selectedWidth / 2));
  targets[node] = { x: base.x, y: base.y };
  // Nodes that were in the old tree but not the new one go home.
  for (const [id, home] of [...moved]) {
    if (targets[id]) continue;
    graph.mergeNodeAttributes(id, { size: home.size, aspectRatio: home.aspectRatio });
    targets[id] = { x: home.x, y: home.y };
    moved.delete(id);
  }

  if (center) {
    // Center the whole tree, not just the selected node.
    const boxes = [
      {
        left: -GROUP.selectedWidth / 2,
        top: -GROUP.boxHeight / 2,
        width: GROUP.selectedWidth,
        height: GROUP.boxHeight,
      },
      ...clusters.map((c) => ({ ...c, top: c.top - 20, height: c.height + 20 })),
    ];
    const minX = Math.min(...boxes.map((b) => b.left));
    const maxX = Math.max(...boxes.map((b) => b.left + b.width));
    const minY = Math.min(...boxes.map((b) => b.top));
    const maxY = Math.max(...boxes.map((b) => b.top + b.height));
    centerOn(node, (minX + maxX) / 2, (minY + maxY) / 2);
  }
  if (animate) cancelAnimation = animateNodes(graph, targets, { duration: 400 });
  else for (const [id, pos] of Object.entries(targets)) graph.mergeNodeAttributes(id, pos);
}

// The relationship names between the selection and a group, with arrows for direction.
function edgeTypesBetween(node: string, ids: string[]) {
  const names = new Set<string>();
  for (const id of ids) {
    graph.forEachEdge(node, id, (_e, a, source) => names.add(source === node ? `${a.edgeType} →` : `← ${a.edgeType}`));
  }
  return [...names].join(', ');
}

// Remember where a node lived before it joined a group, then give it a label-sized box.
function moveNode(id: string, size: number) {
  const a = graph.getNodeAttributes(id);
  if (!moved.has(id)) moved.set(id, { x: a.x, y: a.y, size: a.size, aspectRatio: a.aspectRatio });
  graph.mergeNodeAttributes(id, { size, aspectRatio: BOX_ASPECT * (GROUP.boxWidth / 200) });
}

function restoreGroups(animate: boolean) {
  if (!moved.size) return;
  cancelAnimation?.();
  const targets: Record<string, { x: number; y: number }> = {};
  for (const [id, home] of moved) {
    graph.mergeNodeAttributes(id, { size: home.size, aspectRatio: home.aspectRatio });
    targets[id] = { x: home.x, y: home.y };
  }
  moved.clear();
  treeAnchor = null;
  if (defaultZoomToSize) renderer?.setSetting('zoomToSizeRatioFunction', defaultZoomToSize);
  groupHeaders = [];
  const unfreeze = () => renderer?.setSetting('autoRescale', true);
  if (animate) cancelAnimation = animateNodes(graph, targets, { duration: 300 }, unfreeze);
  else {
    for (const [id, pos] of Object.entries(targets)) graph.mergeNodeAttributes(id, pos);
    unfreeze();
  }
}

// Center the selection and its groups in the space left of the detail panel.
// offsetPx / offsetYPx: where the middle of its groups is, relative to the node.
function centerOn(node: string, offsetPx: number, offsetYPx = 0) {
  const r = renderer!;
  const panelWidth = $('panel').offsetWidth + 16;
  const vp = r.framedGraphToViewport(r.getNodeDisplayData(node)!);
  const target = r.viewportToFramedGraph({ x: vp.x + offsetPx + panelWidth / 2, y: vp.y + offsetYPx });
  r.getCamera().animate({ x: target.x, y: target.y }, { duration: 400 });
}

// Labels move inside circles as you zoom in, so redraw them when the zoom changes.
let labelZoom = 1;
renderer.getCamera().on('updated', ({ ratio }) => {
  if (Math.abs(ratio - labelZoom) / labelZoom < 0.05) return;
  labelZoom = ratio;
  refresh();
});

function zoomTo(node: string) {
  const pos = renderer!.getNodeDisplayData(node);
  if (pos) renderer!.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.3 }, { duration: 500 });
}

// The node's place in the hierarchy (part_of and the other UNDER_EDGES). above: every ancestor, root first, depth 0 at the top.
// below: every descendant as an indented tree (depth 0 = direct children), capped so huge trees stay usable.
function hierarchy(node: string, maxBelow = 64) {
  const levels = new Map<string, number>();
  let frontier = [node];
  for (let level = 1; frontier.length; level++) {
    const next: string[] = [];
    for (const id of frontier)
      graph.forEachOutEdge(id, (e, _a, _s, parent) => {
        if (isUnder(e) && parent !== node && !levels.has(parent)) {
          levels.set(parent, level);
          next.push(parent);
        }
      });
    frontier = next;
  }
  const top = Math.max(0, ...levels.values());
  const above = [...levels]
    .map(([id, level]) => ({ id, depth: top - level }))
    .sort((a, b) => a.depth - b.depth || title(a.id).localeCompare(title(b.id)));

  const below: { id: string; depth: number }[] = [];
  const seen = new Set([node, ...levels.keys()]);
  const walk = (id: string, depth: number) => {
    const children = graph
      .inEdges(id)
      .filter(isUnder)
      .map((e) => graph.source(e))
      .filter((c) => !seen.has(c))
      .sort((a, b) => title(a).localeCompare(title(b)));
    for (const c of children) {
      if (below.length >= maxBelow) return;
      if (seen.has(c)) continue;
      seen.add(c);
      below.push({ id: c, depth });
      walk(c, depth + 1);
    }
  };
  walk(node, 0);
  return { above, below };
}
function title(id: string) {
  return graph.getNodeAttribute(id, 'title') as string;
}

// Siblings: other nodes under the same parent(s).
function siblings(node: string) {
  const groups: { parent: string; members: string[] }[] = [];
  graph.forEachOutEdge(node, (_e, attrs, _s, parent) => {
    if (!UNDER_EDGES.has(attrs.edgeType as string)) return;
    const members = graph
      .inNeighbors(parent)
      .filter((m) => m !== node && graph.someEdge(m, parent, (e2) => isUnder(e2)));
    groups.push({ parent, members });
  });
  return groups;
}

// With "Move boxes" on, drag a box to move it; it stays where you drop it. The tree around a
// selection is laid out for you, so its boxes don't drag.
let dragged: string | null = null;
let dragMoved = false;
renderer.on('downNode', ({ node }) => {
  dragMoved = false;
  if (!movable || moved.size) return;
  dragged = node;
  graph.setNodeAttribute(node, 'fixed', true); // the running layout leaves it alone
  // Hold the framing still, or the whole view rescales as the node leaves the graph's bounds.
  if (!renderer!.getCustomBBox()) renderer!.setCustomBBox(renderer!.getBBox());
});
renderer.on('moveBody', ({ event, preventSigmaDefault }) => {
  if (!dragged) return;
  const pos = renderer!.viewportToGraph(event);
  graph.mergeNodeAttributes(dragged, { x: pos.x, y: pos.y });
  dragMoved = true;
  preventSigmaDefault();
  event.original.preventDefault();
  event.original.stopPropagation();
});
function endDrag() {
  if (!dragged) return;
  graph.removeNodeAttribute(dragged, 'fixed');
  if (dragMoved && mode === 'network') {
    const a = graph.getNodeAttributes(dragged);
    graph.mergeNodeAttributes(dragged, { netX: a.x, netY: a.y });
    saveState();
  }
  dragged = null;
}
renderer.on('downStage', () => (dragMoved = false));
renderer.on('upNode', endDrag);
renderer.on('upStage', endDrag);

renderer.on('clickNode', ({ node }) => !dragMoved && select(node));
renderer.on('doubleClickNode', ({ node, preventSigmaDefault }) => {
  preventSigmaDefault();
  select(node, { zoom: true });
});
// Labels beside a circle are clickable too, since small circles are hard to hit.
function labelAt(point: { x: number; y: number }) {
  if (mode !== 'network' || !renderer) return null;
  let hit: string | null = null;
  graph.forEachNode((id, a) => {
    const d = renderer!.getNodeDisplayData(id);
    if (hit || !d || d.visibility === 'hidden' || !d.label || moved.has(id)) return;
    const shown = focus ? focus.has(id) : !showEverything && (pinned.has(id) || isTopLevel(id));
    if (!shown || labelFits(a.label as string, d.size)) return;
    const c = renderer!.framedGraphToViewport(d);
    const left = c.x + radiusPx(d.size) + 2;
    if (point.x >= left && point.x <= left + labelWidth(a.label as string) && Math.abs(point.y - c.y) <= 9) hit = id;
  });
  return hit;
}
renderer.on('clickStage', ({ event }) => {
  if (dragMoved) return;
  select(labelAt(event));
});
renderer.on('moveBody', ({ event }) => {
  if (!dragged) $('graph').style.cursor = labelAt(event) ? 'pointer' : '';
});

$<HTMLInputElement>('hide-unrelated').onchange = (e) => {
  hideUnrelated = (e.target as HTMLInputElement).checked;
  refresh();
};

// ---------- Detail panel ----------

function nodeLink(id: string) {
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = graph.getNodeAttribute(id, 'title');
  a.style.borderLeft = `4px solid ${graph.getNodeAttribute(id, 'color')}`;
  a.onclick = (ev) => {
    ev.preventDefault();
    select(id, { zoom: true });
  };
  return a;
}

function renderPanel(node: string | null) {
  const panel = $('panel');
  panel.replaceChildren();
  panel.hidden = node === null;
  if (node === null) return;

  const attrs = graph.getNodeAttributes(node);
  const raw = attrs.raw as ExportedNode | null;
  const h = el('h2', attrs.title);
  const typeLine = el('div', '', 'type-line');
  typeLine.append(typeBadge('node', attrs.nodeType), el('code', node.replace(/^default:/, '')));
  panel.append(h, typeLine);

  // Breadcrumb up the hierarchy: root › … › parent.
  const { above } = hierarchy(node, 0);
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

  // Connections grouped by edge type and direction.
  const groups = new Map<string, string[]>();
  graph.forEachOutEdge(node, (_e, a, _s, t) => push(groups, `${a.edgeType} →`, t));
  graph.forEachInEdge(node, (_e, a, s) => push(groups, `← ${a.edgeType}`, s));
  if (groups.size) panel.append(el('h3', `Connections (${graph.degree(node)})`));
  for (const [label, ids] of groups) {
    const edgeType = label.replace(/[←→ ]/g, '');
    const title = el('div', '', 'group-title');
    title.append(typeBadge('edge', edgeType, label));
    const list = el('ul');
    ids.forEach((id) => list.append(li(nodeLink(id))));
    panel.append(title, list);
  }

  for (const { parent, members } of siblings(node)) {
    const title = el('h3', `Siblings in `);
    title.append(nodeLink(parent));
    const show = el('button', 'Show on graph');
    show.onclick = () => {
      focus = new Set([node, parent, ...members]);
      refresh();
    };
    const list = el('ul');
    members.slice(0, 50).forEach((id) => list.append(li(nodeLink(id))));
    if (members.length > 50) list.append(li(el('span', `…and ${members.length - 50} more`)));
    panel.append(title, show, list);
  }
}

// ---------- Search ----------

const searchInput = $<HTMLInputElement>('search');
const results = $('results');
let searchable: { id: string; text: string }[] = [];
const indexSearch = () =>
  (searchable = graph.mapNodes((id, a) => ({
    id,
    text: `${a.title} ${id} ${(a.raw as ExportedNode | null)?.summary ?? ''}`.toLowerCase(),
  })));
indexSearch();

// The search stays in the box while you look at results: clearing a selection brings its matches back.
function runSearch(showList = true) {
  const q = searchInput.value.trim().toLowerCase();
  results.replaceChildren();
  if (!q) {
    select(selected);
    return;
  }
  const matches = searchable.filter((n) => n.text.includes(q)).map((n) => n.id);
  // Searching replaces the selection: its tree and panel close first.
  if (selected !== null) {
    restoreGroups(true);
    renderPanel(null);
  }
  // Brighten every match on the graph; list the first 20.
  selected = null;
  focus = new Set(matches);
  refresh();
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
  const counts = countBy(graph.mapNodes((_id, a) => a.nodeType as string));
  for (const [type, count] of counts) {
    const row = el('li');
    const toggle = el('label');
    const box = el('input') as HTMLInputElement;
    box.type = 'checkbox';
    box.checked = !hiddenTypes.has(type);
    box.onchange = () => {
      box.checked ? hiddenTypes.delete(type) : hiddenTypes.add(type);
      refresh();
      updateHeaders();
    };
    const dot = el('span', '', 'dot');
    dot.style.background = colorFor(type);
    toggle.append(box, dot, el('span', `${type} (${count})`));
    row.append(toggle, helpButton('node', type));
    nodeList.append(row);
  }
  const edgeList = $('legend-edges');
  edgeList.replaceChildren();
  for (const [type, count] of countBy(graph.mapEdges((_e, a) => a.edgeType as string))) {
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

// The (?) button: shows what a node or edge type means.
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

renderLegend();
function updateStats() {
  const showing = graph.filterNodes((id) => onGraph(id)).length;
  $('stats').textContent =
    `${showing === graph.order ? '' : `${showing.toLocaleString()} of `}${graph.order.toLocaleString()} nodes · ` +
    (live() ? `live · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : dataUrl);
}
updateStats();

// ---------- Refresh and live updates ----------
// New data is merged into the graph in place: existing nodes keep their positions, new ones
// appear next to their neighbors, and the selection, search, filters and camera stay as they were.

let refreshing = false;
async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await fetchGraph();
    const keepSelected = selected;
    const camera = renderer!.getCamera().getState();
    restoreGroups(false);
    graph.forEachNode((id, a) => mode === 'network' && graph.mergeNodeAttributes(id, { netX: a.x, netY: a.y }));
    const added = applyData(data);
    placeNewNodes(added, {});
    listLayout();
    const [kx, ky] = mode === 'lists' ? ['listX', 'listY'] : ['netX', 'netY'];
    graph.forEachNode((id, a) =>
      graph.mergeNodeAttributes(id, {
        x: a[kx],
        y: a[ky],
        size: mode === 'lists' ? BOX_SIZE : 5 + Math.sqrt(graph.degree(id)) * 2.5,
        aspectRatio: mode === 'lists' ? BOX_ASPECT : 2.2,
      }),
    );
    indexSearch();
    renderLegend();
    updateStats();
    renderer!.getCamera().setState(camera);
    if (keepSelected && graph.hasNode(keepSelected)) select(keepSelected, { keepCamera: true });
    else if (keepSelected) select(null);
    // A search picked from the results keeps its text; rerun it only when nothing is selected.
    if (!selected && searchInput.value.trim()) runSearch(false);
    loadedVersion = data.version ?? loadedVersion;
    renderer!.refresh();
  } finally {
    refreshing = false;
  }
}
$<HTMLButtonElement>('refresh').onclick = () => refreshData();

// Live mode: ask the server every few seconds whether the database changed.
// Live data reloads itself when the graph changes, so the button is only for snapshots.
if (live()) $('refresh').style.display = 'none';
if (live()) setInterval(pollVersion, 3000);

// ---------- Remembering the view across reloads ----------
// Layout and view state live in this browser's localStorage, per data source.

interface SavedState {
  positions: Record<string, [number, number]>;
  mode: Mode;
  selected: string | null;
  hideUnrelated: boolean;
  hiddenTypes: string[];
  showEverything?: boolean;
  movable?: boolean;
  camera: { x: number; y: number; ratio: number; angle: number };
}
function stateKey() {
  return `mcpedia-viewer:v2:${fileParam ?? 'live'}`;
}
function loadState(): SavedState | null {
  try {
    return JSON.parse(localStorage.getItem(stateKey()) ?? 'null');
  } catch {
    return null;
  }
}
function saveState() {
  if (!renderer || resetting) return;
  const positions: SavedState['positions'] = {};
  graph.forEachNode((id, a) => {
    const home = moved.get(id);
    positions[id] = mode === 'network' ? [home?.x ?? a.x, home?.y ?? a.y] : [a.netX as number, a.netY as number];
  });
  const state: SavedState = {
    positions,
    mode,
    selected,
    hideUnrelated,
    hiddenTypes: [...hiddenTypes],
    showEverything,
    movable,
    camera: renderer.getCamera().getState(),
  };
  try {
    localStorage.setItem(stateKey(), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the view just won't be remembered.
  }
}
addEventListener('pagehide', saveState);

if (saved) {
  hideUnrelated = saved.hideUnrelated;
  $<HTMLInputElement>('hide-unrelated').checked = hideUnrelated;
  saved.hiddenTypes.forEach((t) => hiddenTypes.add(t));
  showEverything = saved.showEverything ?? false;
  $<HTMLInputElement>('show-all').checked = showEverything;
  movable = saved.movable ?? false;
  $<HTMLInputElement>('movable').checked = movable;
  renderLegend();
  if (saved.mode !== mode) setMode(saved.mode);
  renderer.getCamera().setState(saved.camera);
  if (saved.selected && graph.hasNode(saved.selected)) select(saved.selected, { keepCamera: true });
  updateStats();
  refresh();
}
$<HTMLInputElement>('show-all').onchange = (e) => {
  showEverything = (e.target as HTMLInputElement).checked;
  updateStats();
  frameShown();
  refresh();
};
$<HTMLInputElement>('movable').onchange = (e) => {
  movable = (e.target as HTMLInputElement).checked;
};
// Reset view forgets everything this page remembers (selection, filters, moved boxes,
// camera) and starts fresh. The data itself is untouched.
$('reset-view').onclick = () => {
  resetting = true;
  try {
    localStorage.removeItem(stateKey());
  } catch {
    // Nothing saved to forget.
  }
  location.reload();
};
// The main view shows only the top level and pins. A selection or search shows what it involves,
// and clearing it goes back to the top level.
$('collapse').title = 'Clear the selection and tidy the starting layout';
$('show-all').parentElement!.title = 'Off: only top-level and pinned nodes, plus the selection and search matches';
// Collapse goes back to the starting view and tidies it.
$('collapse').onclick = () => {
  searchInput.value = '';
  results.replaceChildren();
  select(null);
  if (mode === 'network') {
    layout.stop();
    tidyLayout();
    animateNodes(
      graph,
      Object.fromEntries(graph.mapNodes((id, a) => [id, { x: a.netX, y: a.netY }])),
      { duration: 400 },
      () => {
        frameShown();
        renderer!.getCamera().reset({ duration: 300 });
      },
    );
  }
  updateStats();
};

// Exposed for the headless smoke test and for poking around in devtools.
Object.assign(window, { graph, renderer, select, refreshData, saveState, tidyLayout, weight });

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
function push(map: Map<string, string[]>, key: string, value: string) {
  map.set(key, [...(map.get(key) ?? []), value]);
}
function average(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function countBy(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  // Ties are broken by name so colors and legend order stay the same from one load to the next.
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
