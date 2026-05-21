import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '..', 'drizzle');

async function run(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const handle = createDb(url);
  try {
    // pgvector extension must exist before the migrations using `vector` columns run.
    await handle.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await migrate(handle.db, { migrationsFolder });

    console.warn('migrations: applied');
  } finally {
    await handle.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
