import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PgDatabase } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

// Any fixed number; it only has to be the same for every server sharing the database.
const MIGRATION_LOCK = 7_411_001;

/**
 * Applies numbered SQL files (`NNN_name.sql`) not yet recorded in
 * schema_migrations, in order, each in its own transaction. Servers starting
 * together take turns on an advisory lock, so each file runs once.
 * Returns the versions it applied.
 */
export async function migrate(db: PgDatabase, dir: string = MIGRATIONS_DIR): Promise<number[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    integer PRIMARY KEY,
    name       text NOT NULL,
    applied_at text NOT NULL
  )`);

  const files = readdirSync(dir)
    .map((name) => ({ name, match: /^(\d+)_.+\.sql$/.exec(name) }))
    .filter((f): f is { name: string; match: RegExpExecArray } => f.match !== null)
    .map((f) => ({ name: f.name, version: Number(f.match[1]) }))
    .sort((a, b) => a.version - b.version);

  const done: number[] = [];
  for (const file of files) {
    const applied = await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      const seen = await tx.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file.version]);
      if (seen.length > 0) return false;
      await tx.exec(readFileSync(`${dir}/${file.name}`, 'utf8'));
      await tx.query('INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)', [
        file.version,
        file.name,
        new Date().toISOString(),
      ]);
      return true;
    });
    if (applied) done.push(file.version);
  }
  return done;
}
