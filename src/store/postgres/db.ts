import pg from 'pg';

/** What PostgresStore needs from a connection: parameterized queries and multi-statement scripts. */
export interface Sql {
  query<R>(text: string, params?: unknown[]): Promise<R[]>;
  exec(script: string): Promise<void>;
}

/** A database the store can run transactions on. Tests back it with PGlite. */
export interface PgDatabase extends Sql {
  /** Runs `fn` in one transaction on one connection; rolls back if it throws. */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** A connection pool for a `postgres://` URL. */
export function connectPool(url: string): PgDatabase {
  const pool = new pg.Pool({ connectionString: url });
  // An idle connection dropped by the server is replaced on the next query; don't crash on it.
  pool.on('error', (err) => console.error(`postgres: ${err.message}`));
  const wrap = (c: pg.Pool | pg.PoolClient): Sql => ({
    query: async <R>(text: string, params?: unknown[]) => (await c.query(text, params)).rows as R[],
    exec: async (script) => {
      await c.query(script);
    },
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
