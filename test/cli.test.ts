import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assertNotDatabase, errorLine, pickCommand, writeLinesAtomically } from '../src/cli.js';
import { UserError } from '../src/core/errors.js';

describe('pickCommand', () => {
  it('starts the server with no command, or with only flags', () => {
    expect(pickCommand([])).toEqual({ command: 'serve', args: [] });
    expect(pickCommand(['--verbose'])).toEqual({ command: 'serve', args: ['--verbose'] });
  });

  it('routes a known command with the rest as its arguments', () => {
    expect(pickCommand(['export', '--out', 'g.jsonl'])).toEqual({ command: 'export', args: ['--out', 'g.jsonl'] });
  });

  it('refuses an unknown command instead of starting the server', () => {
    expect(() => pickCommand(['exprot'])).toThrow(UserError);
    expect(errorLine(catchError(() => pickCommand(['exprot'])))).toBe(
      'Unknown command: exprot. Commands: export (or no command to start the server).',
    );
  });
});

describe('writeLinesAtomically', () => {
  it('writes every line, then moves the file into place', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mcpdia-cli-')), 'out.jsonl');
    const result = await writeLinesAtomically(path, async (write) => {
      await write('{"a":1}');
      await write('{"b":2}');
      return 2;
    });
    expect(result).toBe(2);
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });

  it('leaves the target untouched and cleans up when writing fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpdia-cli-'));
    const path = join(dir, 'out.jsonl');
    writeFileSync(path, 'previous export\n');
    const failing = writeLinesAtomically(path, async (write) => {
      await write('{"a":1}');
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    expect(readFileSync(path, 'utf8')).toBe('previous export\n');
    expect(readdirSync(dir)).toEqual(['out.jsonl']);
  });

  it('creates no file when the export fails before writing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpdia-cli-'));
    const path = join(dir, 'out.jsonl');
    await expect(
      writeLinesAtomically(path, async () => Promise.reject(new UserError('Unknown namespace: x.'))),
    ).rejects.toThrow(UserError);
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('assertNotDatabase', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpdia-db-'));
  const db = join(dir, 'graph.db');
  writeFileSync(db, '');

  it('refuses the database and its side files, however the path is written', () => {
    for (const out of [
      db,
      `${db}-wal`,
      `${db}-shm`,
      `${db}-journal`,
      relative(process.cwd(), db),
      join(dir, '.', 'graph.db'),
    ]) {
      expect(() => assertNotDatabase(out, db), out).toThrow(UserError);
    }
  });

  it('refuses the database through a symlinked folder', () => {
    if (process.platform === 'win32') return; // Symlinks need extra rights on Windows.
    const link = join(mkdtempSync(join(tmpdir(), 'mcpdia-link-')), 'here');
    symlinkSync(dir, link);
    expect(() => assertNotDatabase(join(link, 'graph.db'), db)).toThrow(UserError);
  });

  it('allows any other file', () => {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    expect(() => assertNotDatabase(join(dir, 'graph.jsonl'), db)).not.toThrow();
    expect(() => assertNotDatabase(join(dir, 'sub', 'graph.db'), db)).not.toThrow();
    expect(() => assertNotDatabase(join(dir, 'missing', 'graph.db'), db)).not.toThrow();
  });
});

describe('errorLine', () => {
  it('shows fixable errors as one line and leaves bugs alone', () => {
    expect(errorLine(new UserError('Unknown namespace: secret.', 'readable: default'))).toBe(
      'Unknown namespace: secret. readable: default',
    );
    const badFlag = catchError(() => parseArgs({ args: ['--nope'], options: {} }));
    expect(errorLine(badFlag)).toMatch(/Unknown option '--nope'/);
    expect(errorLine(new Error('bug'))).toBeNull();
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected an error');
}
