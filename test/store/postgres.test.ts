import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPool, type PgDatabase, type Sql } from '../../src/store/postgres/db.js';
import { migrate } from '../../src/store/postgres/migrate.js';
import { PostgresStore } from '../../src/store/postgres/PostgresStore.js';
import { graphStoreSuite } from './graphstore.suite.js';

/**
 * The shared suite against Postgres. PGlite is real Postgres in-process, so this
 * runs on every `npm test`. Set MCPDIA_TEST_DATABASE_URL to also run it against a
 * server; that database is wiped before each test.
 */

// One PGlite for the file, emptied before each test: starting one per test is slow.
let lite: PGlite;
beforeAll(async () => {
  lite = await PGlite.create();
});
afterAll(async () => {
  await lite.close();
});

function pglite(db: PGlite): PgDatabase {
  const wrap = (c: Pick<PGlite, 'query' | 'exec'>): Sql => ({
    query: async <R>(text: string, params?: unknown[]) => (await c.query<R>(text, params)).rows,
    exec: async (script) => {
      await c.exec(script);
    },
  });
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: async () => {}, // Shared across tests; closed in afterAll.
  };
}

/** Drops everything the migrations made, so the next store starts empty. */
async function wipe(db: Sql): Promise<void> {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
}

graphStoreSuite('postgres (PGlite)', async () => {
  const db = pglite(lite);
  await wipe(db);
  return PostgresStore.open(db);
});

const url = process.env.MCPDIA_TEST_DATABASE_URL;
if (url) {
  graphStoreSuite('postgres (server)', async () => {
    const db = connectPool(url);
    await wipe(db);
    return PostgresStore.open(db);
  });
}

describe('postgres migrate', () => {
  it('applies each file once and records it', async () => {
    const db = pglite(lite);
    await wipe(db);
    expect(await migrate(db)).toEqual([1]);
    expect(await migrate(db)).toEqual([]);
    expect(await db.query('SELECT version, name FROM schema_migrations')).toEqual([
      { version: 1, name: '001_init.sql' },
    ]);
  });

  it('records a version snapshot with body length on every write', async () => {
    const db = pglite(lite);
    await wipe(db);
    const store = await PostgresStore.open(db);
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
    expect(await db.query('SELECT version, body_len, change_type FROM node_versions ORDER BY version')).toEqual([
      { version: 1, body_len: 3, change_type: 'create' },
      { version: 2, body_len: 6, change_type: 'update' },
    ]);
  });
});
