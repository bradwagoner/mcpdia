import type { Context } from '../context.js';
import type { GraphStore, RecentEntry } from '../store/GraphStore.js';
import { UserError } from './errors.js';

export interface RecentInput {
  /** Only nodes the caller wrote last. */
  mine?: boolean;
  /** An ISO date or timestamp, or a span like `3d`, `12h`, `2w`. */
  since?: string;
  limit: number;
}

/**
 * Latest writes and useful-marked nodes, newest first (ADR 0005).
 * Reads are deliberately not tracked.
 */
export async function recent(ctx: Context, store: GraphStore, input: RecentInput): Promise<RecentEntry[]> {
  return store.recent({
    namespaces: ctx.namespaces,
    since: input.since ? parseSince(input.since) : undefined,
    updatedBy: input.mine ? ctx.caller : undefined,
    limit: input.limit,
  });
}

const SPAN_MS = { h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

export function parseSince(value: string, now: number = Date.now()): string {
  const span = /^(\d+)\s*([hdw])$/i.exec(value.trim());
  if (span) {
    const unit = span[2]!.toLowerCase() as keyof typeof SPAN_MS;
    return new Date(now - Number(span[1]) * SPAN_MS[unit]).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new UserError(`Can't read since: ${value}.`, 'Use a date like 2026-10-01 or a span like 3d.');
  }
  return date.toISOString();
}
