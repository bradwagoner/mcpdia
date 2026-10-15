# 0014: Graph viewer library

- Status: Accepted
- Date: 2026-10-15

## Context
A built-in viewer (#26) should let a person explore a graph in the browser. Requirements:

- Nodes are clickable items.
- Click to drill in: neighbors, siblings and a detail panel.
- Search.
- Relationships drawn as links.
- Hide unrelated nodes while something is selected.
- A legend of node and edge types, each with a (?) description.
- A permissive free license: use and redistribute without modifying the library.
- Handles thousands of nodes and up.

The search box, detail panel and legend are plain HTML around the graph whichever library is used, so they do not decide the choice. Rendering, interaction hooks, scale and license do.

## Decision
The viewer offers **two renderers**, picked from the page: **Sigma.js v4 + graphology** (the default) and **Cytoscape.js**. Both implement every requirement above without modifying the library. If keeping both in step costs too much, one is dropped.

Sigma renders with WebGL and needs no framework. graphology holds the data and provides layouts (ForceAtlas2 in a web worker). Per-node styling hooks cover highlight, dim and hide, and click, hover and camera events cover drill-in. Cytoscape renders to canvas, with compound nodes and many built-in layouts.

What was checked on 2026-10-15 (npm registry):

| Option | License | Latest | Renderer | Notes |
|---|---|---|---|---|
| sigma + graphology | MIT + MIT | 4.0.2 (2026-10-14) + 0.26.0 | WebGL | Built for large graphs. v4 went stable on 2026-10-08. |
| cytoscape | MIT | 3.34.3 (2026-09-07) | Canvas | Richest styling and layouts. Compound nodes. |
| vis-network | Apache-2.0 OR MIT | 10.1.2 (2026-08-19) | Canvas | Easy API with built-in physics. Large package. |
| force-graph / 3d-force-graph | MIT | 1.52.0 / 1.80.1 (2026-09) | Canvas / WebGL | Quickest to prototype. Force layout only, on the main thread. |
| @antv/g6 | MIT | 5.1.1 (2026-05-08) | Canvas / WebGL | All-in-one with legend and tooltip plugins. Heavy. |
| reagraph | Apache-2.0 | 4.32.0 (2026-06-25) | WebGL | React only. |
| cosmos.gl | MIT | - | WebGL (GPU) | Whole-graph overview at very large scale. Thin on interaction. |

Prototype measurements, in a headless browser without a GPU (a real machine is faster):

- 10k nodes load in about 1 s and 50k in about 3 s. Panning and zooming stay cheap.
- Restyling every node on selection takes about 0.3 s at 10k nodes and about 2 s at 50k.

## Alternatives considered
- **vis-network:** easy, but canvas physics slows past a few thousand nodes.
- **force-graph:** great for a quick demo; force layout only, so tidy neighbor groups would fight the library.
- **G6:** capable, but much heavier than the viewer needs.
- **Reagraph:** ties the viewer to React.
- **cosmos.gl:** a possible add-on for a whole-graph overview at very large scale, not a base for interaction.

## Consequences
- The viewer is a separate, optional piece: `viewer/` has its own `package.json` (including its own `better-sqlite3`), so the MCP server's install stays lean and the viewer runs on its own.
- Two renderers means each viewer feature is written twice. Cytoscape's canvas rendering also slows down sooner than Sigma's WebGL on big graphs.
- Beyond a few thousand nodes, the viewer should draw a working set (search results plus what the user expands) instead of the whole graph, since restyling cost grows with node count.
- Sigma v4 is new; pin its version and recheck on upgrades.
- Deferred: how the viewer is launched (for example `mcpedia view`), serving it over the v0.3 HTTP transport, and an optional Docker setup that runs the server and viewer together.
