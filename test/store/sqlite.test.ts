import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/store/sqlite/migrate.js';
import { SqliteStore } from '../../src/store/sqlite/SqliteStore.js';
import { graphStoreSuite } from './graphstore.suite.js';

graphStoreSuite('sqlite', async () => new SqliteStore(':memory:'));

describe('migrate', () => {
  it('applies each numbered file once, in order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpedia-migrations-'));
    writeFileSync(join(dir, '002_more.sql'), 'ALTER TABLE t ADD COLUMN b TEXT;');
    writeFileSync(join(dir, '001_first.sql'), 'CREATE TABLE t (a TEXT);');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    const db = new Database(':memory:');

    expect(migrate(db, dir)).toEqual([1, 2]);
    expect(migrate(db, dir)).toEqual([]);
    expect(db.prepare('SELECT name FROM schema_migrations ORDER BY version').all()).toEqual([
      { name: '001_first.sql' },
      { name: '002_more.sql' },
    ]);
  });

  it('rolls back a failing file and leaves it unrecorded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpedia-migrations-'));
    writeFileSync(join(dir, '001_bad.sql'), 'CREATE TABLE t (a TEXT); NOT SQL;');
    const db = new Database(':memory:');
    expect(() => migrate(db, dir)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 't'").get()).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
  });

  it('records a version snapshot with body length on every write', async () => {
    const store = new SqliteStore(':memory:');
    const n = await store.createNode({
      namespace: 'default',
      key: 'note/a',
      type: 'note',
      title: 'A',
      summary: null,
      body: 'abc',
      properties: {},
      aliases: [],
      tags: [],
      source: 'local',
      author: 'local',
    });
    await store.updateNode(n.id, { body: 'abcdef' }, 'local');
    // Reach past the interface: history is not exposed yet.
    const db = (store as unknown as { db: Database.Database }).db;
    expect(db.prepare('SELECT version, body_len, change_type FROM node_versions ORDER BY version').all()).toEqual([
      { version: 1, body_len: 3, change_type: 'create' },
      { version: 2, body_len: 6, change_type: 'update' },
    ]);
    await store.close();
  });
});
