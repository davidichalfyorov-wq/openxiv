import { createHash } from 'node:crypto';
import { Worker, type ConnectionOptions } from 'bullmq';
import type { AppContext } from '../context.js';
import { QUEUE_NAMES } from '../context.js';
import { makeFigureExtractor, type FigureExtractor } from '../services/figure-extractor.js';
import {
  extractFiguresFromSourceArchive,
  sourceFigureUploadKey,
} from '../services/source-figure-extractor.js';

/**
 * `openxiv.pdf-figures` consumer. Fires after `pdf-finalize` succeeds
 * (we enqueue from the finalize worker rather than racing both off the
 * same submission saga — the figure pipeline is strictly Tier-2 and
 * never blocks publishing).
 *
 * Pipeline:
 *   1. Extract explicit image/PDF/SVG assets from the submitted source archive.
 *   2. Extract PDF crops from the final paper via GROBID + Poppler.
 *   3. Prefer PDF crops when they exist, because they cover inline TikZ/PGF
 *      figures and match what the reader sees in the final PDF.
 *   4. Upload each PNG to a deterministic object key.
 *   5. Atomic replace `paper_figures` rows for (paperId, version).
 *
 * Idempotency: the worker uses a deterministic blob key, so re-runs
 * overwrite the same MinIO objects. The DB upsert clears the old rows
 * for this (paper, version) before inserting, so a partial earlier run
 * never leaves stale rows behind.
 *
 * Fault isolation:
 *   - GROBID 503 / timeout      → extract returns []; we record empty.
 *   - pdftocairo missing/failed → caught in extractor; affected figures dropped.
 *   - MinIO 5xx                 → throw → BullMQ retries (5 attempts).
 *   - DB unavailable            → throw → retries.
 *
 * Concurrency: 1 by default — pdftocairo each spike to ~200 MB RAM,
 * and we don't want a 30-figure paper saturating the worker box.
 */

export interface PdfFiguresJobData {
  paperId: string;
  versionId: string;
  /** Force re-extract even if rows already exist. */
  force?: boolean;
}

interface PdfFiguresProcessorOptions {
  extractor?: FigureExtractor;
  publicBase?: string;
  bucket?: string;
}

export async function processPdfFiguresJob(
  ctx: AppContext,
  data: PdfFiguresJobData,
  options: PdfFiguresProcessorOptions = {},
): Promise<
  | { skipped: true; reason: string; count?: number }
  | { count: number; version: number }
> {
  const { paperId, versionId, force } = data;
  const grobidUrl = process.env['GROBID_URL'] ?? 'http://grobid:8070';
  const extractor = options.extractor ?? makeFigureExtractor({ grobidUrl });

  // Load the paper.
  const paperResult = await ctx.repos.papers.loadWithRelations(paperId);
  if (paperResult.isErr()) throw paperResult.error;
  const loaded = paperResult.value;
  if (!loaded) {
    // Not-found at this point is terminal — propagating to BullMQ
    // failure is the right move.
    return { skipped: true, reason: 'paper-not-found' };
  }
  // Resolve the requested version (cold path if not latest).
  let version = loaded.latestVersion;
  if (!version || version.id !== versionId) {
    const all = await ctx.repos.papers.allVersions(paperId);
    if (all.isErr()) throw all.error;
    version = all.value.find((v) => v.id === versionId) ?? null;
  }
  if (!version || !version.pdfKey) {
    return { skipped: true, reason: 'no-source-pdf' };
  }

  // Short-circuit on any completed extraction unless forced. A paper
  // may legitimately have zero figures; `paper_figures` rows alone
  // cannot represent that completed empty state.
  if (!force) {
    const completed = await ctx.repos.paperFigures.extractionForVersion(
      paperId,
      version.versionNumber,
    );
    if (completed.isOk() && completed.value) {
      return {
        skipped: true,
        reason: 'already-extracted',
        count: completed.value.figureCount,
      };
    }
    const existing = await ctx.repos.paperFigures.forVersion(paperId, version.versionNumber);
    if (existing.isOk() && existing.value.length > 0) {
      return { skipped: true, reason: 'already-extracted', count: existing.value.length };
    }
  }

  // Prefer PDF crops when available: they match the final paper and also
  // cover inline TikZ/PGF figures that do not exist as separate source
  // assets. Source assets remain the fallback when PDF extraction is empty
  // or GROBID/Poppler is unavailable.
  const publicBase = options.publicBase ?? process.env['PUBLIC_WEB_BASE'] ?? 'https://openxiv.net';
  const bucket = options.bucket ?? process.env['S3_BUCKET'] ?? 'openxiv-blobs';
  const sourceRows = [];
  if (version.sourceKey) {
    const sourceBlob = await ctx.clients.storage.get(version.sourceKey);
    if (sourceBlob.isErr()) throw sourceBlob.error;
    const sourceFigures = await extractFiguresFromSourceArchive(
      sourceBlob.value.body,
      version.sourceKey.split('/').pop() ?? 'source.zip',
    );
    for (const fig of sourceFigures) {
      const key = sourceFigureUploadKey({ paperId, version: version.versionNumber, figure: fig });
      const upload = await ctx.clients.storage.put(key, fig.data, {
        contentType: fig.contentType,
      });
      if (upload.isErr()) throw upload.error;
      sourceRows.push({
        paperId,
        version: version.versionNumber,
        idx: sourceRows.length,
        imageUrl: `${publicBase}/${bucket}/${key}`,
        caption: fig.caption,
        page: null,
        bbox: null,
        type: 'figure' as const,
      });
    }
  }

  const pdfRows = [];
  const blob = await ctx.clients.storage.get(version.pdfKey);
  if (blob.isErr()) throw blob.error;
  const extractResult = await extractor.extractFigures(blob.value.body);
  if (extractResult.isErr()) throw extractResult.error;
  const figures = extractResult.value;
  for (const fig of figures) {
    const sha = createHash('sha256').update(fig.png).digest('hex').slice(0, 12);
    const key = `papers/${paperId}/v${version.versionNumber}-fig-${fig.idx}-${sha}.png`;
    const upload = await ctx.clients.storage.put(key, fig.png, { contentType: 'image/png' });
    if (upload.isErr()) throw upload.error;
    pdfRows.push({
      paperId,
      version: version.versionNumber,
      idx: pdfRows.length,
      imageUrl: `${publicBase}/${bucket}/${key}`,
      caption: fig.caption,
      page: fig.page,
      bbox: fig.bbox,
      type: fig.type,
    });
  }

  const rows = pdfRows.length > 0 ? pdfRows : sourceRows;
  const extractionSource: 'source_archive' | 'pdf_grobid' =
    pdfRows.length > 0 ? 'pdf_grobid' : 'source_archive';

  // Replace.
  const persist = await ctx.repos.paperFigures.replaceForVersion(
    paperId,
    version.versionNumber,
    rows,
  );
  if (persist.isErr()) throw persist.error;

  const reason =
    extractionSource === 'source_archive'
      ? rows.length > 0
        ? 'source_archive_figures'
        : 'source_archive_no_figures'
      : rows.length > 0
        ? 'pdf_grobid_figures'
        : 'pdf_grobid_no_figures';
  const mark = await ctx.repos.paperFigures.markExtractionComplete({
    paperId,
    version: version.versionNumber,
    source: extractionSource,
    reason,
    figureCount: rows.length,
  });
  if (mark.isErr()) throw mark.error;

  // Observability counters for the ops dashboard.
  ctx.redis.hincrby('pdf-figures:counts', `paper:${paperId}`, rows.length).catch(() => {});
  ctx.redis.hincrby('pdf-figures:summary', 'total-figures', rows.length).catch(() => {});

  return { count: rows.length, version: version.versionNumber };
}

export function makePdfFiguresWorker(
  ctx: AppContext,
  connection: ConnectionOptions,
  concurrency = 1,
): Worker<PdfFiguresJobData> {
  const grobidUrl = process.env['GROBID_URL'] ?? 'http://grobid:8070';
  const extractor = makeFigureExtractor({ grobidUrl });

  return new Worker<PdfFiguresJobData>(
    QUEUE_NAMES.pdfFigures,
    async (job) => processPdfFiguresJob(ctx, job.data, { extractor }),
    {
      connection,
      concurrency,
      // Retry policy: 5 attempts, exponential, gives transient GROBID/MinIO
      // outages a fair shot before the job gives up. Final attempt at ~10min.
      // The extractor itself is fail-closed so retries only fire when *we*
      // throw — MinIO 5xx, DB unavailable, etc.
    },
  );
}
