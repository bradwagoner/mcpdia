# 0026: Starter sets loaded on startup

- Status: Accepted
- Date: 2026-10-26
- Builds on: ADR 0003 (keys and namespaces), ADR 0006 (solo + seed), ADR 0007 (late-bound edges), ADR 0008 (fix by detection and cleanup), ADR 0016 (tools say what happened), ADR 0025 (HTTP and Docker)

## Context
A graph is more useful when it can lean on knowledge someone else keeps: a starter set that explains a tool, or what a team has written down. Your own notes should stay yours. The core already reads a list of namespaces and writes to one, but the list is fixed to `default`, and nothing loads an export back in.

There are three ways to combine graphs:
- **A second MCPdia server** registered next to yours. Works today, but the model has to pick which server to ask, the two never rank together, and notes can't link across.
- **One server reading two databases live.** Always current, but merges search across stores and needs the other database's credentials.
- **Copies loaded into namespaces of your own graph.** One search, links across, no credentials; fresh as of each start.

A copy raises one question: what happens when you edit a node and the source changes it too?

## Decision
**The server loads a list of starter sets into their own namespaces when it starts and reads them next to your graph. You can edit anything; when the source also changed a node you edited, the load writes a conflict to review instead of picking a winner.**

- **Configure.** `MCPDIA_STARTERS=mcpdia=starters/mcpdia.jsonl,team=http://localhost:7411/export` names each set and where it comes from: a file path or an `http(s)` URL serving `mcpdia-jsonl`. Each set loads into the namespace named before the `=`. Relative paths are read from the database's folder, since a client may start the server in any folder. Sources are read in parallel, with a 5-second timeout per URL and a 50 MB cap; UTF-8 with or without a byte-order mark and UTF-16 files are accepted.
- **Read and write.** Starter namespaces join the read list. `MCPDIA_NAMESPACES` adds others, and `MCPDIA_WRITE_NAMESPACE` (default `default`) picks where new nodes go. A starter namespace can't be the write namespace, since a load mirrors its source. Starter nodes are editable like any other.
- **Reconcile.** Each reload compares three versions per key: base (the source version last applied or acknowledged), yours (the node now) and incoming. Versions are hashed on content and status, never ids or timestamps.
  - Incoming matches base: the source didn't change it, so your edits stay.
  - Yours matches base: you didn't touch it, so it takes the incoming version.
  - Yours matches incoming: nothing to do.
  - Both changed and differ: yours stays, and a conflict is written.
  - Gone from the source: deleted if you never touched it, otherwise kept with a conflict saying it was removed upstream.
  - Nodes you add to a starter namespace yourself were never in the set, so a reload leaves them alone. A first load refuses a namespace that already holds other nodes.
  - Links the set wrote follow the source; links you added are never removed.
- **Conflicts.** One `conflict` node per key, `conflict/<node key>` (e.g. `conflict/concept/stubs-first`) in the starter namespace, holding the incoming version and a `conflicts_with` link to your node. A newer incoming version while it's open updates it in place, so history keeps every version. Resolving means deleting it, which marks that incoming version as handled; a later change in the source reopens the same node. Nothing resolves itself. This is the keep-both rule planned for merge import, made repeatable.
- **Seeing them.** The load lists open conflicts on stderr at startup and in `mcpdia seed`'s output. `get` and `search` mark a node with an open conflict, `(newer version in mcpdia:conflict/concept/x)`, with a line at `full` saying how to resolve it. The lookup runs only when more than one namespace is visible. The `resolve-conflicts` prompt walks a model through them.
- **Skipped loads.** A source whose content hasn't changed since the last start is skipped, whatever its export time.
- **Unreachable source.** The server starts anyway with the copy it loaded last time, and says so on stderr.
- **Links.** Your notes can link to `mcpdia:concept/stubs-first`. Edges are late-bound (ADR 0007), so they resolve as soon as the set loads.
- **Making a set.** Export with no `--namespace` defaults to the write namespace: your own graph, never the sets you loaded, so sets aren't passed along by accident. Someone who wants the same set lists it too, under the same name, so links into it resolve on both sides. A file that repeats a key, as an export spanning namespaces would, is refused. `mcpdia export --tag <tag>` exports the nodes with that tag and the edges between them. The HTTP server serves `GET /export?namespace=…&tag=…` on the same localhost-only rule as `/mcp`, so one MCPdia can load another's graph as a starter set.
- **One-off loads.** `mcpdia seed <file> --namespace <ns>` runs the same load from the command line.

This works like a package install that keeps your local changes. If you want edits to show up mid-session, connect to the team server directly; that's the second-server setup above.

## Alternatives considered
- **A second server only.** No code, but two places to look and a second tool list per session.
- **Live reads across two databases.** Needs search merging across stores and database credentials; a better fit for team mode with auth (v0.3).
- **Read-only starter sets.** Simplest to reload, but editing something you imported is a reasonable thing to want, and refusing it is frustrating.
- **Copy-on-edit,** where an edit makes your own shadow copy. Updates keep flowing, but every read has to choose between two nodes with one key.
- **One conflict node per incoming version.** Simpler keys, but several unseen versions pile up, and resolving one could hide the next.
- **Replace a starter namespace by deleting its rows.** Simpler, but loses history and breaks the no-hard-delete rule from ADR 0003.

## Consequences
- New users can start with a populated graph, and a team can share a curated set without sharing anyone's private notes.
- Your edits survive reloads, and a real disagreement with the source shows up where you'll see it: at load time and on the node itself.
- A node you edited stops following the source until you take its version.
- Which sets you see is fixed at startup; changing the list means a restart.
- Keys from starter namespaces show qualified (`mcpdia:concept/x`), a few tokens each.
- Merge import into your own namespace stays on the v0.2 list and can reuse the conflict nodes.
