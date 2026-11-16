# 0027: Live demo on GitHub Pages

- Status: Accepted
- Date: 2026-11-16
- Builds on: ADR 0014 (graph viewer), ADR 0026 (starter sets)

## Context
The viewer is the quickest way to show what MCPdia stores, but seeing it took a clone, two installs and a graph of your own. A reader on GitHub should be able to click once and browse a real graph.

The viewer already ran without its server: when `api/graph` was missing it fell back to an exported file. That fallback cost a failed request on every load, and the dev reload stream failed the same way, so a hosted copy opened with errors in the console.

## Decision
- **The demo is the viewer as plain files on GitHub Pages**, published by `.github/workflows/demo.yml` on every push to `main`. Nothing is hosted beyond static files, so there is no server to run or protect.
- **It shows the MCPdia starter set**, committed as `starters/mcpdia-starter.jsonl`: the concepts, how-tos and decision records about MCPdia itself, cut from the project's own graph with `export --tag mcpdia-starter`. The same file works as a `MCPDIA_STARTERS` source.
- **The workflow loads the set the way a user would**: `mcpdia seed` into a throwaway database, then the viewer's export to `www/data/mcpdia.json`. A change that breaks seeding or the export breaks the demo build.
- **The viewer's server marks the page live.** `scripts/serve.mjs` adds `<meta name="mcpdia-live">` to `index.html`. With the mark, the page reads `api/graph`, polls for changes and listens for dev reloads. Without it, the page reads `data/mcpdia.json` and makes no `api/` requests. `?data=` still picks a file either way.
- **A snapshot can name the node it opens on.** `export-graph.mjs --select=namespace:key` writes `selected` into the file, and a browser with no saved view opens on that node. The demo opens on `mcpdia:concept/mcpdia`.

## Alternatives considered
- **A hosted MCPdia server with the live viewer.** Shows nodes arriving as an agent writes, but costs money and needs abuse protection. The viewer is read-only, so visitors would see the same thing as the snapshot.
- **Committing the built viewer and serving it from a branch or `docs/`.** No workflow, but the bundle is a build output and the demo goes stale whenever the viewer changes.
- **Keeping the fallback request.** Works, and leaves two failed requests in every visitor's console.
- **The Kestrel benchmark dataset as demo data.** Fictional; the starter set is real content and explains the project while showing the viewer.

## Consequences
- The demo follows `main` with no manual step. The starter file is refreshed by hand: export it again when the starter nodes change.
- The starter set is public. Tag a node `mcpdia-starter` only if it can be.
- A page hosted as plain files never polls, so the demo cannot show live updates; the README covers that with a recording.
- Pages needs one repository setting: Settings, Pages, Source: GitHub Actions.
