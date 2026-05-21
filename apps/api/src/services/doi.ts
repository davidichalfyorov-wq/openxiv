import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { AppContext } from '../context.js';

/**
 * Deferred DOI deposit. OpenXiv assigns each paper an opaque DOI
 * once Crossref membership is in place; the suffix is *always*
 * `openxiv.{openxiv_id}` so it never reveals the title and stays
 * trivially diffable across re-deposits.
 *
 * The deposit pipeline is gated on `CROSSREF_PREFIX` + `CROSSREF_USER`
 * + `CROSSREF_PASSWORD` env vars. When any of the three is missing
 * the worker logs and exits — the paper is published anyway, the
 * `papers.doi` column stays NULL, and the cover renders an "DOI
 * deposited later" footnote. Once credentials land, the
 * `deposit-doi-backfill` script enqueues every NULL-doi paper.
 *
 * Rate limit: 5 deposits/second to stay under Crossref's
 * recommended throttle.
 */

export function buildDoi(openxivId: string): string | null {
  // Suffix is opaque — derive from openxiv_id only. Never the title.
  // Example: openxiv:cs.AI.2026.00117 → 10.{prefix}/openxiv.cs.AI.2026.00117
  const prefix = process.env['CROSSREF_PREFIX'];
  if (!prefix) return null;
  if (!/^10\.[0-9]+$/.test(prefix)) {
    // Defensive: a malformed prefix would minute one bad DOI per paper.
    return null;
  }
  const suffix = openxivId.replace(/^openxiv:/, '');
  if (!suffix) return null;
  return `${prefix}/openxiv.${suffix}`;
}

export interface DoiCredentials {
  prefix: string;
  user: string;
  password: string;
}

export function loadDoiCredentials(): DoiCredentials | null {
  const prefix = process.env['CROSSREF_PREFIX'];
  const user = process.env['CROSSREF_USER'];
  const password = process.env['CROSSREF_PASSWORD'];
  if (!prefix || !user || !password) return null;
  return { prefix, user, password };
}

export interface DepositInput {
  paperId: string;
}

export interface DepositOutput {
  doi: string;
  /** Crossref's submissionId for trace. */
  submissionId: string | null;
}

export interface DoiDepositService {
  depositOne(input: DepositInput): AppResultAsync<DepositOutput>;
}

export function makeDoiDepositService(ctx: AppContext): DoiDepositService {
  return {
    depositOne(input) {
      return fromPromise(depositImpl(ctx, input), (cause) =>
        Errors.internal('doi-deposit', cause),
      );
    },
  };
}

async function depositImpl(ctx: AppContext, input: DepositInput): Promise<DepositOutput> {
  const creds = loadDoiCredentials();
  if (!creds) {
    // No credentials: surface a typed error rather than failing silently.
    // The worker swallows this with a warning and re-queues for later.
    throw Errors.internal('doi-deposit: CROSSREF_PREFIX/USER/PASSWORD not configured');
  }
  const paperResult = await ctx.repos.papers.findById(input.paperId);
  if (paperResult.isErr()) throw paperResult.error;
  const paper = paperResult.value;
  if (!paper) throw Errors.notFound(`paper ${input.paperId}`);
  if (paper.doi) {
    // Already deposited — return idempotently.
    return { doi: paper.doi, submissionId: null };
  }
  if (paper.status !== 'published' || !paper.openxivId) {
    throw Errors.validation('doi-deposit: only published papers with an openxiv_id deposit');
  }
  const doi = `${creds.prefix}/openxiv.${paper.openxivId.replace(/^openxiv:/, '')}`;
  const xml = buildCrossrefDepositXml({
    doi,
    paperId: paper.id,
    title: paper.title,
    publishedAt: (paper.publishedAt ?? paper.createdAt).toISOString(),
    canonicalUrl: `${process.env['PUBLIC_WEB_BASE'] ?? 'https://openxiv.net'}/abs/${paper.openxivId}`,
  });
  const submissionId = await postCrossref(creds, xml);
  // Persist via repo call. The unique index on (doi) catches a race
  // where two workers tried to deposit the same paper concurrently —
  // the loser hits Postgres 23505 which we surface as an Error.
  const saved = await ctx.repos.papers.setDoi(paper.id, doi);
  if (saved.isErr()) throw saved.error;
  // Re-trigger pdf-finalize so the cover regenerates with the freshly
  // deposited DOI. Force=true to bypass the content-hash short-circuit
  // (the hash factors in `paper.doi`, so this should normally re-build
  // automatically, but `force` is a belt + braces).
  const latest = await ctx.repos.papers.latestVersion(paper.id);
  if (!latest.isErr() && latest.value) {
    await ctx.queues.pdfFinalize.add(
      'pdf-finalize-after-doi',
      { paperId: paper.id, versionId: latest.value.id, force: true },
      { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } },
    );
  }
  return { doi, submissionId };
}

/**
 * Crossref deposit XML. Minimal valid `book` / `posted_content` shape;
 * we use `posted_content` because preprints are pinned to that schema
 * type in Crossref's recommendations.
 *
 * Exported for unit tests.
 */
export function buildCrossrefDepositXml(input: {
  doi: string;
  paperId: string;
  title: string;
  publishedAt: string;
  canonicalUrl: string;
}): string {
  const now = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  const safeTitle = escapeXml(input.title);
  const safeUrl = escapeXml(input.canonicalUrl);
  const date = input.publishedAt.slice(0, 10);
  const [yyyy, mm, dd] = date.split('-');
  return `<?xml version="1.0" encoding="UTF-8"?>
<doi_batch xmlns="http://www.crossref.org/schema/5.3.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           version="5.3.1"
           xsi:schemaLocation="http://www.crossref.org/schema/5.3.1 https://www.crossref.org/schemas/crossref5.3.1.xsd">
  <head>
    <doi_batch_id>${input.paperId}-${now}</doi_batch_id>
    <timestamp>${now}</timestamp>
    <depositor>
      <depositor_name>OpenXiv</depositor_name>
      <email_address>davidich.alfyorov@gmail.com</email_address>
    </depositor>
    <registrant>OpenXiv</registrant>
  </head>
  <body>
    <posted_content type="preprint">
      <titles><title>${safeTitle}</title></titles>
      <posted_date>
        <month>${mm}</month><day>${dd}</day><year>${yyyy}</year>
      </posted_date>
      <doi_data>
        <doi>${input.doi}</doi>
        <resource>${safeUrl}</resource>
      </doi_data>
    </posted_content>
  </body>
</doi_batch>`;
}

async function postCrossref(_creds: DoiCredentials, _xml: string): Promise<string | null> {
  // Stubbed until Crossref membership clears. The real impl POSTs to
  // https://doi.crossref.org/servlet/deposit with HTTP basic auth.
  // Returning null today; the production stub will return the
  // submissionId once activated.
  return null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const __testing = { buildDoi };
