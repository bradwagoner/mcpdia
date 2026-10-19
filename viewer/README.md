# Graph viewer

An optional, read-only browser view of an MCPedia graph. It is separate from the MCP server: its own folder, its own dependencies, and nothing the server needs. Pick the renderer you like: [Sigma.js](https://www.sigmajs.org) v4 with [graphology](https://graphology.github.io), or [Cytoscape.js](https://js.cytoscape.org) (all MIT). Tracked in #26; the library choice is ADR 0014.

- **Starts small:** the network view opens with the top-level nodes (not `part_of`, `comments_on` or `candidate_for` anything) and the pinned "start here" nodes, as circles in rings. The ones with the most underneath them are biggest and sit in the middle. A label moves inside its circle once it fits, and labels are clickable too. **Show all** shows the whole graph.
- **Click a node:** its family tree gathers around it. Ancestors sit above it up to the top, siblings beside it (and each ancestor's siblings beside that ancestor), descendants below. Each layer is grouped by edge kind and sorted by type, and other neighbors sit in groups on the far sides, one per type and relationship. Clicking a node that is already in the tree reshapes it in place. Clicking empty space puts everything back.
- **Detail panel:** summary, full text, properties, connections by edge type and direction, and siblings (nodes `part_of` the same parent). Every entry is a link.
- **Search** highlights matches as you type, and stays put when you go back to the main view. **Hide unrelated** hides everything outside the selection.
- **Legend:** node and edge types with counts; untick to hide. Each (?) explains the type, from `type_defs.description` when set, otherwise a built-in default. New types get a color of their own; the hierarchy edges (`part_of`, `comments_on`, `candidate_for`) are listed in `src/family.ts`.
- **Ghost nodes:** edges whose target is not in the graph show as grey `(ghost)` nodes (ADR 0007).
- **Move boxes:** tick it to drag nodes around the main view. The tree around a selection is laid out for you, so its boxes stay put.
- **Lists view:** one vertical column per node type.
- **Live updates:** with `npm start`, the page notices when the graph changes and merges the changes in place. New nodes appear next to their neighbors; your selection, search, filters and camera stay put. When the page isn't live, **Reload data** fetches the latest on demand.
- **Remembers your view:** layout, selection, filters, view mode and camera survive a browser reload (stored in this browser's localStorage). **Collapse** clears the selection and search and tidies the layout; **Reset view** goes all the way back to the starting view.

## Two renderers

Both renderers have the same features. Sigma.js (`src/main.ts`) is the default: WebGL, built for big graphs. Cytoscape.js (`src/cytoscape.ts`) draws the tree's groups as compound nodes. The tree layout itself is shared (`src/family.ts`). Switch with the dropdown in the header, or open `?renderer=cytoscape`. Each renderer remembers its own view.

## Run it

```
cd viewer
npm install
npm start                   # http://localhost:8000, live from ~/.mcpedia/mcpedia.db (or $MCPEDIA_DB)
```

`npm start` opens the database read-only and only listens on localhost. To point it at another graph, run `npm start -- path/to/graph.db`.

Want it on your phone or another computer? `npm start -- --lan` (or `npm run dev -- --lan`) also listens on your local network and prints the address to open. There's no login, so anyone on that network can read the graph; use it on networks you trust. On Windows, allow Node through the firewall for **Private networks** when asked.

Working on the viewer itself? `npm run dev` does the same as `npm start`, and also rebuilds on save and reloads the page, keeping your view.

For a snapshot instead, `npm run export` writes `www/data/mcpedia.json`; open it with `?data=data/mcpedia.json`.

For a scale test, `npm run generate -- 10000` writes fake data; open `http://localhost:8000/?data=data/generated-10000.json`.

Exports land in `www/data/`, which is git-ignored because a real graph can hold private notes.
