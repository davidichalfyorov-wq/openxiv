import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

const { Pool } = pg;

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

export interface DbHandle {
  readonly db: Database;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Create a Postgres pool and bind drizzle to it. Caller is responsible for
 * calling close() at process shutdown.
 *
 * Pool sizing: API process serves bursts of short reads — default `max: 10`
 * is fine. Worker process can run 8 concurrent jobs, each potentially
 * issuing multiple queries; bump `max` for workers via env or the option.
 */
export function createDb(
  connectionString: string,
  options: { max?: number; idleTimeoutMs?: number; connectionTimeoutMs?: number } = {},
): DbHandle {
  const envMax = process.env['PG_POOL_MAX']
    ? Number.parseInt(process.env['PG_POOL_MAX'], 10)
    : undefined;
  const pool = new Pool({
    connectionString,
    max: options.max ?? envMax ?? 10,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    allowExitOnIdle: false,
  });
  pool.on('error', (err) => {
    // Pool emits 'error' for idle-client failures; logging it here prevents
    // the default unhandledError -> process.exit handler from firing.
    console.error('[pg-pool] idle client error:', err.message);
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}
