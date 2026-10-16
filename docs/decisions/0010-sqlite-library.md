# 0010: SQLite library

- Status: Accepted
- Date: 2026-10-07

## Context
v0.1 needs SQLite with FTS5 (SQLite's built-in full-text search, which `search` runs on). The library must install cleanly with `npx` on Windows, macOS and Linux, and sit behind the async `GraphStore` interface.

## Decision
Use **better-sqlite3**. It is the long-standing default for SQLite in Node, ships its own recent SQLite with FTS5 compiled in, and carries no "experimental" label on any Node version. Its calls are synchronous; `SqliteStore` wraps them in async methods, which costs nothing and keeps the interface ready for Postgres.

Each store owns its migrations, so the numbered SQL files live in `src/store/sqlite/migrations/` rather than at the repo root (Postgres will need its own dialect).

What was checked on 2026-10-07:

| Option | Status | FTS5 | Install |
|---|---|---|---|
| better-sqlite3 13.0.3 | Stable, mature; v13 moved to N-API, so one prebuilt binary works across Node versions | Yes, on its bundled SQLite 3.53.4 | One dependency with a prebuilt binary |
| node:sqlite | Experimental on Node 22 and 24 (prints a warning); release candidate from Node 25.7 | Yes, on Node 22.22 (SQLite 3.50.4) | Nothing to install |
| libsql | Its README says maintained but not developed; points new projects to Turso | Not documented | Native binary |

## Alternatives considered
- **node:sqlite:** the strongest runner-up, since zero dependencies is attractive. It loses for now because a portfolio project should not print "experimental" warnings on current LTS releases. Its API is nearly identical, so switching later touches only `SqliteStore.ts`; a future ADR can supersede this one once it is stable on an LTS.
- **libsql:** in maintenance mode, and adds a remote-database feature we do not need.

## Consequences
- One native dependency. Prebuilt binaries cover the common platforms, so users need no build tools. better-sqlite3 13 ships them inside the npm package (win32, darwin, linux and linuxmusl, each x64 and arm64) with no install script, so `npm install` never invokes node-gyp. Checked 2026-10-13 on Windows 11 with no Visual Studio: a packed MCPedia installed and answered `orient` over stdio.
- The SQLite version comes from the library, not the user's Node, so FTS5 behaves the same everywhere.
- Requires Node 22 or later.
