import { createWriteStream, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { UserError } from './core/errors.js';

/** Command-line helpers for src/index.ts, kept apart so they can be tested without starting anything. */

export const COMMANDS = ['export', 'seed'] as const;
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
  const closed = new Promise<void>((done) => out.once('close', () => done()));
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
    // The file may still be opening; remove it only once the stream has let go of it.
    out.destroy();
    await closed;
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Refuses an export path that is the database itself or one of its side files
 * (-wal, -shm, -journal): writing there would replace the graph.
 * Paths are compared after resolving symlinks, and case-insensitively on Windows and macOS.
 */
export function assertNotDatabase(out: string, dbPath: string): void {
  // The output usually doesn't exist yet, so resolve its folder instead.
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      try {
        return join(realpathSync(dirname(resolve(path))), basename(path));
      } catch {
        return resolve(path);
      }
    }
  };
  const fold = (path: string) =>
    process.platform === 'win32' || process.platform === 'darwin' ? path.toLowerCase() : path;
  const db = real(dbPath);
  const target = fold(real(out));
  if (['', '-wal', '-shm', '-journal'].some((suffix) => fold(db + suffix) === target)) {
    throw new UserError(`--out ${out} is the database being exported.`, 'Pick another file name.');
  }
}

/** Turns errors a user can fix (a bad flag, an unknown namespace) into one line. */
export function errorLine(err: unknown): string | null {
  if (err instanceof UserError) return [err.message, err.hint].filter(Boolean).join(' ');
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_')) return (err as Error).message;
  return null;
}
