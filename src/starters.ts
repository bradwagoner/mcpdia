import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Starter } from './context.js';
import { lastLoaded, loadStarter, type LoadResult } from './core/starters.js';
import type { GraphStore } from './store/GraphStore.js';

/** How long a starter URL gets before the server starts without it. Sources are read in parallel. */
export const FETCH_TIMEOUT_MS = 5_000;
/** Larger sources are refused rather than held in memory. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

const isUrl = (source: string) => /^https?:\/\//i.test(source);

/**
 * The text of a starter source: an `http(s)` URL serving mcpdia-jsonl, or a
 * file path. Relative paths are taken from `baseDir`, the database's folder,
 * since a client may start the server in any working directory.
 */
export async function readSource(source: string, baseDir: string): Promise<string> {
  if (isUrl(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_SOURCE_BYTES) throw tooBig();
    return decode(Buffer.from(await res.arrayBuffer()));
  }
  const path = resolve(baseDir, source);
  if ((await stat(path)).size > MAX_SOURCE_BYTES) throw tooBig();
  return decode(await readFile(path));
}

function tooBig(): Error {
  return new Error(`larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB`);
}

/** UTF-8, or UTF-16 when a byte-order mark says so (Windows PowerShell 5.1 writes `>` redirects that way). */
function decode(bytes: Buffer): string {
  if (bytes.length > MAX_SOURCE_BYTES) throw tooBig();
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  return bytes.toString('utf8');
}

/** One stderr line about a load. */
export function describeLoad(r: LoadResult): string {
  const parts = r.unchanged
    ? ['unchanged']
    : [
        r.created && `${r.created} new`,
        r.updated && `${r.updated} changed`,
        r.deleted && `${r.deleted} removed`,
        r.kept && `${r.kept} edited here kept`,
        (r.edgesAdded || r.edgesRemoved) && `links +${r.edgesAdded} -${r.edgesRemoved}`,
      ].filter(Boolean);
  if (r.conflicts.length) parts.push(`${r.conflicts.length} conflict${r.conflicts.length === 1 ? '' : 's'} to review`);
  const lines = [`starter ${r.namespace}: ${r.nodes} nodes${parts.length ? ` (${parts.join(', ')})` : ''}`];
  for (const c of r.conflicts) lines.push(`  ${r.namespace}:${c.key} (${c.state}) on ${r.namespace}:${c.nodeKey}`);
  if (r.conflicts.length)
    lines.push('  Resolve them with the resolve-conflicts prompt, or get each one and delete it when done.');
  return lines.join('\n');
}

/**
 * Loads each starter set before the server starts (ADR 0026). Sources are read
 * in parallel, then loaded one at a time. A source that can't be read or isn't
 * an export never stops the server: it keeps the copy loaded last time and says so.
 */
export async function loadStarters(
  store: GraphStore,
  starters: Starter[],
  baseDir: string,
  log: (line: string) => void,
): Promise<void> {
  const texts = await Promise.allSettled(starters.map((s) => readSource(s.source, baseDir)));
  for (const [i, { name, source }] of starters.entries()) {
    try {
      const text = texts[i]!;
      if (text.status === 'rejected') throw text.reason;
      log(describeLoad(await loadStarter(store, name, source, text.value)));
    } catch (err) {
      const before = await lastLoaded(store, name);
      const kept = before ? `using the copy loaded ${before.loadedAt}` : 'starting without it';
      log(`starter ${name}: could not load ${source} (${(err as Error).message}); ${kept}`);
    }
  }
}
