import { appendFile } from 'node:fs/promises';
import { ulid } from './ulid.js';

/** One line of the metrics log: what the server saw for one tool call (ADR 0019). */
export interface ToolCallRecord {
  ts: string;
  session: string;
  tool: string;
  ms: number;
  ok: boolean;
  req_chars: number;
  res_chars: number;
  level?: string;
}

export interface MetricsLog {
  file: string;
  /** One per server start, so a session's total is a plain sum. */
  session: string;
  record(entry: Omit<ToolCallRecord, 'session'>): void;
  /** Resolves once every recorded line is written. */
  flush(): Promise<void>;
}

/**
 * Appends one JSON line per tool call to `file`. Writes run in order and in
 * the background; a failed write is reported once on stderr and never fails
 * the tool call.
 */
export function openMetricsLog(file: string): MetricsLog {
  const session = ulid();
  let pending: Promise<void> = Promise.resolve();
  let warned = false;
  return {
    file,
    session,
    record(entry) {
      const { ts, ...rest } = entry;
      const line = JSON.stringify({ ts, session, ...rest }) + '\n';
      pending = pending
        .then(() => appendFile(file, line, 'utf8'))
        .catch((err: unknown) => {
          if (warned) return;
          warned = true;
          console.error(`metrics: could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
        });
    },
    flush: () => pending,
  };
}
