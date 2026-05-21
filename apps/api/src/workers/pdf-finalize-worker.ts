import { Worker, type ConnectionOptions } from 'bullmq';
import type { AppContext } from '../context.js';
import { QUEUE_NAMES } from '../context.js';
import { makePdfFinalizeService } from '../services/pdf-finalize.js';

/**
 * BullMQ consumer for `openxiv.pdf-finalize`. Triggered from:
 *
 *   1. `submissions.ts` after the bridge stage on a fresh submission.
 *   2. `doi-deposit-worker.ts` after a DOI is successfully deposited
 *      (the cover changes; we re-build).
 *   3. The admin batch script `scripts/finalize-all-papers.ts`.
 *
 * Idempotent — `pdf-finalize.ts` skips when the content hash matches.
 * BullMQ retry policy: 5 attempts with exponential backoff. Final
 * blob upload is the most fragile step (MinIO 5xx); retrying lets it
 * recover without operator intervention.
 *
 * Concurrency: 2 by default. pdf-lib + qrcode each peak ~30 MB heap;
 * 2 concurrent jobs stay well under the worker's 512 MB budget.
 */

export interface FinalizeJobData {
  paperId: string;
  versionId: string;
  /** Force a re-build even if content_hash matches. */
  force?: boolean;
}

export function makePdfFinalizeWorker(
  ctx: AppContext,
  connection: ConnectionOptions,
  concurrency = 2,
): Worker<FinalizeJobData> {
  const service = makePdfFinalizeService(ctx);
  const worker = new Worker<FinalizeJobData>(
    QUEUE_NAMES.pdfFinalize,
    async (job) => {
      const r = await service.finalizeVersion({
        paperId: job.data.paperId,
        versionId: job.data.versionId,
        ...(job.data.force === true ? { force: true } : {}),
      });
      if (r.isErr()) throw r.error;
      // Tier-2: kick off figure extraction after finalize succeeds. We
      // enqueue rather than inline so the finalize worker never blocks
      // on GROBID (which can take 30-60s for a 20-page paper) and a
      // GROBID outage doesn't compound into a finalize retry storm.
      // `force` is NOT propagated — a re-finalize triggered by a fresh
      // DOI deposit shouldn't necessarily re-crop figures. The figures
      // worker has its own short-circuit on existing rows.
      void ctx.queues.pdfFigures
        .add(
          'pdf-figures-after-finalize',
          { paperId: job.data.paperId, versionId: job.data.versionId },
          { attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
        )
        .catch((e: unknown) => {
          console.warn(
            '[pdf-finalize] failed to enqueue pdf-figures:',
            (e as Error)?.message ?? e,
          );
        });
      return r.value;
    },
    {
      connection,
      concurrency,
    },
  );
  return worker;
}
