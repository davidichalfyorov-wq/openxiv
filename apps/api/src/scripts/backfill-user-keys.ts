/**
 * Idempotent backfill: ensure every did:web user has a published signing
 * keypair on their row. Skips users with publicSigningKey already set;
 * also skips did:plc users since their authoritative key lives on
 * plc.directory.
 *
 * Run as: `node /app/apps/api/dist/scripts/backfill-user-keys.js`
 * Env: OPENXIV_KEK_BASE64 must be set.
 *
 * Batches of 100 rows; partial failure does not roll back already-keyed
 * users (each is its own transaction in setKeys).
 */
import 'dotenv/config';
import { parseEnv } from '@openxiv/shared';
import { buildContext } from '../context.js';
import { makeUserKeysService } from '../services/user-keys.js';

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const ctx = await buildContext(env);
  const keys = makeUserKeysService(ctx);
  try {
    // Sanity-check KEK before touching the DB.
    keys.loadKek();
    const pool = ctx.db.pool;
    const result = await pool.query<{ id: string; did: string; public_signing_key: string | null }>(
      `SELECT id, did, public_signing_key
         FROM users
        WHERE did NOT LIKE 'did:plc:%'
          AND public_signing_key IS NULL
        ORDER BY created_at ASC`,
    );
    console.warn(`backfill: ${result.rows.length} users to update`);
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of result.rows) {
      const r = await keys.ensureKeypair(row.id);
      if (r.isErr()) {
        failed++;
        console.error(`  ${row.did}: error — ${r.error.message}`);
        continue;
      }
      if (r.value.rotated) {
        ok++;
      } else {
        skipped++;
      }
    }
    console.warn(`backfill done: rotated=${ok} skipped=${skipped} failed=${failed}`);
  } finally {
    await ctx.shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
