/* eslint-disable no-console -- Admin CLI script intentionally writes progress to stdout. */
/**
 * Admin batch: enqueue pdf-finalize for every published paper's latest version.
 *
 * USAGE:
 *   node /app/apps/api/dist/scripts/finalize-all-papers.js [--force] [--limit=N] [--batch=20]
 *
 * Use this after a cover-template change so current papers get regenerated
 * through the same worker path as future submissions. Without --force the
 * worker still rebuilds whenever computeInputHash differs, including after
 * COVER_TEMPLATE_VERSION changes.
 */
import 'dotenv/config';
import { parseEnv } from '@openxiv/shared';
import { buildContext } from '../context.js';

interface Args {
  readonly force: boolean;
  readonly limit: number;
  readonly batch: number;
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
    const rows = (
      await ctx.db.pool.query<Row>(
        /* sql */ `
          SELECT pv.paper_id AS paper_id, pv.id AS version_id
          FROM paper_versions pv
          JOIN papers p ON p.id = pv.paper_id
          WHERE p.status = 'published'
            AND pv.pdf_key IS NOT NULL
            AND pv.version_number = (
              SELECT MAX(version_number) FROM paper_versions WHERE paper_id = pv.paper_id
            )
          ORDER BY p.published_at ASC NULLS LAST, p.created_at ASC
          LIMIT $1
        `,
        [args.limit],
      )
    ).rows;

    console.log(`[finalize-all-papers] candidates: ${rows.length} (force=${args.force})`);
    const runId = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '');
    console.log(`[finalize-all-papers] run: ${runId}`);
    let enqueued = 0;
    for (let i = 0; i < rows.length; i += args.batch) {
      const slice = rows.slice(i, i + args.batch);
      for (const row of slice) {
        await ctx.queues.pdfFinalize.add(
          'pdf-finalize-backfill',
          {
            paperId: row.paper_id,
            versionId: row.version_id,
            ...(args.force ? { force: true } : {}),
          },
          {
            jobId: `pdf-finalize-backfill-${runId}-${row.version_id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 60_000 },
          },
        );
        enqueued += 1;
      }
      if (i + args.batch < rows.length) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    console.log(`[finalize-all-papers] enqueued: ${enqueued}`);
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
