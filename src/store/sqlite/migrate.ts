import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/**
 * Applies numbered SQL files (`NNN_name.sql`) not yet recorded in
 * schema_migrations, in order, each in its own transaction.
 * Returns the versions it applied.
 */
export function migrate(db: Database.Database, dir: string = MIGRATIONS_DIR): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: number }).version),
  );

  const files = readdirSync(dir)
    .map((name) => ({ name, match: /^(\d+)_.+\.sql$/.exec(name) }))
    .filter((f): f is { name: string; match: RegExpExecArray } => f.match !== null)
    .map((f) => ({ name: f.name, version: Number(f.match[1]) }))
    .sort((a, b) => a.version - b.version);

  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const done: number[] = [];
  for (const file of files) {
    if (applied.has(file.version)) continue;
    const sql = readFileSync(`${dir}/${file.name}`, 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(file.version, file.name, new Date().toISOString());
    })();
    done.push(file.version);
  }
  return done;
}
