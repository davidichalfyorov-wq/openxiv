/* eslint-disable no-console -- Admin CLI script intentionally writes progress to stdout. */
/**
 * Admin batch: enqueue figure-extraction for every published paper that
 * doesn't already have a completed `paper_figure_extractions` marker for
 * its latest version. Idempotent — re-running is safe (the worker
 * short-circuits when completion is recorded unless `force=true`).
 *
 * USAGE:
 *   node /app/apps/api/dist/scripts/figures-extract-all.js [--force] [--limit=N] [--batch=20]
 *
 * Why a script rather than a one-off SQL: the work happens in the
 * worker subprocess and goes through GROBID + pdftocairo + MinIO upload
 * + DB upsert; we want the queue to throttle it (the worker's
 * concurrency=1 means GROBID never sees more than one paper in flight).
 *
 * The `--batch` flag sleeps between enqueue batches so a 5-000 paper
 * backfill doesn't dump the entire load on Redis in one go (Redis
 * happily takes it, but readers see queue depth blip).
 */
import 'dotenv/config';
import { parseEnv } from '@openxiv/shared';
import { buildContext } from '../context.js';

interface Args {
  force: boolean;
  limit: number;
  batch: number;
}

function parseArgs(): Args {
  let force = false;
  let limit = Number.MAX_SAFE_INTEGER;
  let batch = 20;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--force') {
      force = true;
      continue;
    }
    const m = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const key = m[1];
    const val = m[2] ?? '';
    if (key === 'limit') limit = Math.max(1, Number.parseInt(val, 10) || 0);
    else if (key === 'batch') batch = Math.max(1, Number.parseInt(val, 10) || 0);
  }
  return { force, limit, batch };
}

async function main(): Promise<number> {
  const args = parseArgs();
  const env = parseEnv(process.env);
  const ctx = await buildContext(env);
  try {
    type Row = { paper_id: string; version_id: string };
    const pool = ctx.db.pool;
    // Pick the latest version for each published paper. If extraction
    // has not completed for that (paper, version), it's a candidate.
    // `force` skips the NOT EXISTS check so EVERY paper gets re-enqueued.
    const sql = args.force
      ? /* sql */ `
        SELECT pv.paper_id AS paper_id, pv.id AS version_id
        FROM paper_versions pv
        JOIN papers p ON p.id = pv.paper_id
        WHERE p.status = 'published'
          AND pv.version_number = (
            SELECT MAX(version_number) FROM paper_versions WHERE paper_id = pv.paper_id
          )
        ORDER BY p.published_at ASC
        LIMIT $1
      `
      : /* sql */ `
        SELECT pv.paper_id AS paper_id, pv.id AS version_id
        FROM paper_versions pv
        JOIN papers p ON p.id = pv.paper_id
        WHERE p.status = 'published'
          AND pv.version_number = (
            SELECT MAX(version_number) FROM paper_versions WHERE paper_id = pv.paper_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM paper_figure_extractions pfe
            WHERE pfe.paper_id = pv.paper_id AND pfe.version = pv.version_number
          )
        ORDER BY p.published_at ASC
        LIMIT $1
      `;
    const rows = (await pool.query<Row>(sql, [args.limit])).rows;
    console.log(`[figures-extract-all] candidates: ${rows.length} (force=${args.force})`);
    let enqueued = 0;
    for (let i = 0; i < rows.length; i += args.batch) {
      const slice = rows.slice(i, i + args.batch);
      for (const r of slice) {
        await ctx.queues.pdfFigures.add(
          'figures-backfill',
          {
            paperId: r.paper_id,
            versionId: r.version_id,
            ...(args.force ? { force: true } : {}),
          },
          { attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
        );
        enqueued++;
      }
      // Throttle between batches so the queue depth display stays
      // readable. Five-second pause is plenty given concurrency=1 on
      // the consumer side.
      if (i + args.batch < rows.length) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
    console.log(`[figures-extract-all] enqueued: ${enqueued}`);
    return 0;
  } finally {
    await ctx.shutdown();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
