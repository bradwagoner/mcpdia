import { createWriteStream, renameSync, rmSync } from 'node:fs';
import { UserError } from './core/errors.js';

/** Command-line helpers for src/index.ts, kept apart so they can be tested without starting anything. */

export const COMMANDS = ['export'] as const;
export type Command = (typeof COMMANDS)[number] | 'serve';

/** No command (or only flags) starts the server. Anything else must be a known command. */
export function pickCommand(argv: string[]): { command: Command; args: string[] } {
  const [first, ...rest] = argv;
  if (first === undefined || first.startsWith('-')) return { command: 'serve', args: argv };
  if ((COMMANDS as readonly string[]).includes(first)) return { command: first as Command, args: rest };
  throw new UserError(
    `Unknown command: ${first}.`,
    `Commands: ${COMMANDS.join(', ')} (or no command to start the server).`,
  );
}

/**
 * Writes lines to `path` through a temp file next to it, renamed into place
 * once everything is written. If writing fails, the target is left untouched.
 */
export async function writeLinesAtomically<T>(
  path: string,
  produce: (write: (line: string) => Promise<void>) => Promise<T>,
): Promise<T> {
  const tmp = `${path}.${process.pid}.tmp`;
  const out = createWriteStream(tmp);
  const failed = new Promise<never>((_, reject) => out.once('error', reject));
  failed.catch(() => {}); // Raced below; this only stops an unhandled rejection warning.
  const write = async (line: string) => {
    if (!out.write(line + '\n')) await Promise.race([new Promise((done) => out.once('drain', done)), failed]);
  };
  try {
    const result = await Promise.race([produce(write), failed]);
    await Promise.race([new Promise<void>((done) => out.end(() => done())), failed]);
    renameSync(tmp, path);
    return result;
  } catch (err) {
    out.destroy();
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Turns errors a user can fix (a bad flag, an unknown namespace) into one line. */
export function errorLine(err: unknown): string | null {
  if (err instanceof UserError) return [err.message, err.hint].filter(Boolean).join(' ');
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_')) return (err as Error).message;
  return null;
}
