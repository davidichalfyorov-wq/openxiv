import { createHash } from 'node:crypto';
import {
  Errors,
  computeTrustPassport,
  type AppResultAsync,
  type TrustPassportInputs,
  fromPromise,
} from '@openxiv/shared';
import { openxivIdToUrl } from '@openxiv/shared';
import type { PaperVersionRecord, PaperWithRelations } from '@openxiv/db';
import type { AppContext } from '../context.js';
import { generateCoverPdf, type CoverInput } from './pdf-cover.js';
import { mergeCoverAndBody, stampLeftSidebar } from './pdf-sidebar.js';
import {
  extractCitationContentEvidence,
  extractCitationSectionsFromSourceFiles,
  type CitationContentEvidence,
  type CitationEvidenceSection,
} from './citation-evidence.js';
import { extractToFileNodes } from './archive-extract.js';
import { buildProvenanceTimeline } from './provenance.js';

/**
 * Orchestrator: take a published paper + version + original PDF blob,
 * stamp the OpenXiv left sidebar onto each page, prepend the cover
 * page, and re-upload to MinIO under `papers/{id}/v{ver}-final.pdf`.
 *
 * Idempotent: the content hash of the *input* (original PDF + DOI
 * string + paper metadata) is recorded on `paper_versions.final_pdf_content_hash`.
 * Re-running with the same inputs short-circuits to a no-op.
 *
 * Fault isolation cascade:
 *   1. Cover-gen fail  → fall back to sidebar-only final.
 *   2. Sidebar fail    → fall back to the bare original (no-op final).
 *   3. Upload fail     → record the error, keep DB state pre-finalize.
 * The original `pdf_key` is always retrievable; finalize is purely additive.
 *
 * Triggers:
 *   - Saga stage after `bsky_bridge` enqueues a finalize job for the
 *     new version.
 *   - Successful DOI deposit re-enqueues finalize (the cover changes).
 *   - Admin "finalize-all-papers" backfill enqueues one per version.
 */

export interface FinalizeInput {
  paperId: string;
  versionId: string;
  /** Force re-build even when the content hash matches. */
  force?: boolean;
}

export interface FinalizeOutput {
  finalPdfUrl: string;
  contentHash: string;
  /** True iff we skipped re-build (content hash matched). */
  skipped: boolean;
  /** Which cascade stage actually shipped — useful for ops dashboards. */
  variant: 'cover+sidebar' | 'sidebar-only' | 'original-only';
}

const PUBLIC_BASE = process.env['PUBLIC_WEB_BASE'] ?? 'https://openxiv.net';
const COVER_TEMPLATE_VERSION = 'openxiv-cover-v6-six-lane-evidence';

export interface PdfFinalizeService {
  finalizeVersion(input: FinalizeInput): AppResultAsync<FinalizeOutput>;
}

export function makePdfFinalizeService(ctx: AppContext): PdfFinalizeService {
  return {
    finalizeVersion(input) {
      return fromPromise(finalizeImpl(ctx, input), (cause) =>
        Errors.internal('pdf-finalize', cause),
      );
    },
  };
}

async function finalizeImpl(ctx: AppContext, input: FinalizeInput): Promise<FinalizeOutput> {
  // Load the paper, version, and PDF bytes through repos. We avoid
  // touching drizzle directly here so the orchestrator stays testable
  // with mock repos.
  const paperResult = await ctx.repos.papers.loadWithRelations(input.paperId);
  if (paperResult.isErr()) throw paperResult.error;
  const loaded = paperResult.value;
  if (!loaded) throw Errors.notFound(`paper ${input.paperId}`);
  // `loadWithRelations` only gives us `latestVersion`; if the caller
  // asked about a different version, fetch the full list. Most calls
  // target latestVersion, so this is the cold path.
  let version: PaperVersionRecord | undefined;
  if (loaded.latestVersion && loaded.latestVersion.id === input.versionId) {
    version = loaded.latestVersion;
  } else {
    const all = await ctx.repos.papers.allVersions(input.paperId);
    if (all.isErr()) throw all.error;
    version = all.value.find((v) => v.id === input.versionId);
  }
  if (!version) throw Errors.notFound(`paper_version ${input.versionId}`);
  if (!version.pdfKey) {
    // No source PDF to finalize; treat as a no-op rather than an error.
    return {
      finalPdfUrl: '',
      contentHash: '',
      skipped: true,
      variant: 'original-only',
    };
  }

  const coverInput = await buildCoverInput(ctx, loaded, version);

  // Compute the hash of the inputs that go into the final output. If
  // it matches what's already stored, skip the whole pipeline.
  const inputHash = computeInputHash({
    paperId: loaded.paper.id,
    versionId: version.id,
    pdfKey: version.pdfKey,
    doi: loaded.paper.doi,
    primaryCategory: loaded.paper.primaryCategory,
    crossListings: loaded.paper.crossListings ?? [],
    license: loaded.paper.license,
    title: loaded.paper.title,
    postedAt: (loaded.paper.publishedAt ?? loaded.paper.createdAt).toISOString(),
    trust: coverInput.trust,
  });

  if (!input.force && version.finalPdfContentHash === inputHash && version.finalPdfUrl) {
    return {
      finalPdfUrl: version.finalPdfUrl,
      contentHash: inputHash,
      skipped: true,
      variant: 'cover+sidebar',
    };
  }

  // Download the original.
  const originalBytes = await downloadFromMinio(ctx, version.pdfKey);

  // Try the full pipeline. On failure, peel back to the next-safest.
  let finalBytes: Buffer;
  let variant: FinalizeOutput['variant'];

  let sidebarBytes: Buffer = originalBytes;
  let sidebarOk = false;
  try {
    const sidebar = await stampLeftSidebar(originalBytes, {
      openxivId: loaded.paper.openxivId ?? loaded.paper.id,
      version: version.versionNumber,
      primaryCategory: loaded.paper.primaryCategory,
      postedAt: (loaded.paper.publishedAt ?? loaded.paper.createdAt).toISOString(),
    });
    sidebarBytes = sidebar.buffer;
    sidebarOk = true;
  } catch (e) {
    // Sidebar stamping failed: ignore, keep the original as-is.
    ctx.redis.hincrby('pdf-finalize:errors', 'sidebar', 1).catch(() => {});
    console.warn('[pdf-finalize] sidebar stamping failed:', (e as Error).message);
  }

  let cover: { buffer: Buffer; contentHash: string } | null = null;
  try {
    cover = await generateCoverPdf(coverInput);
  } catch (e) {
    ctx.redis.hincrby('pdf-finalize:errors', 'cover', 1).catch(() => {});
    console.warn('[pdf-finalize] cover generation failed:', (e as Error).message);
  }

  if (cover && sidebarOk) {
    try {
      // Pass the openxivId so the merged PDF's XMP /Keywords carries
      // a stable `openxiv:<id>` marker that survives Tectonic's own
      // metadata. Round-trip extractable via extractOpenxivIdFromPdf.
      finalBytes = await mergeCoverAndBody(cover.buffer, sidebarBytes, {
        openxivId: loaded.paper.openxivId ?? loaded.paper.id,
      });
      variant = 'cover+sidebar';
    } catch (e) {
      ctx.redis.hincrby('pdf-finalize:errors', 'merge', 1).catch(() => {});
      console.warn('[pdf-finalize] merge failed:', (e as Error).message);
      finalBytes = sidebarBytes;
      variant = 'sidebar-only';
    }
  } else if (sidebarOk) {
    finalBytes = sidebarBytes;
    variant = 'sidebar-only';
  } else {
    finalBytes = originalBytes;
    variant = 'original-only';
  }

  // Upload the final blob. Key carries the version + content hash so a
  // CDN/cache invalidation is implicit.
  const finalKey = `papers/${loaded.paper.id}/v${version.versionNumber}-final-${inputHash.slice(0, 12)}.pdf`;
  await uploadToMinio(ctx, finalKey, finalBytes);
  const publicUrl = `${PUBLIC_BASE}/openxiv-blobs/${finalKey}`;

  // Persist on paper_versions. Use raw SQL through the repo so an
  // accidental Drizzle-side schema drift surfaces here, not in the
  // happy path.
  await persistFinalUrl(ctx, version.id, publicUrl, inputHash);
  return { finalPdfUrl: publicUrl, contentHash: inputHash, skipped: false, variant };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeInputHash(input: {
  paperId: string;
  versionId: string;
  pdfKey: string;
  doi: string | null;
  primaryCategory: string;
  crossListings: string[];
  license: string;
  title: string;
  postedAt: string;
  trust: CoverInput['trust'];
}): string {
  // JSON is fine — ordering matters only insofar as we keep it stable.
  const canon = JSON.stringify({
    coverTemplateVersion: COVER_TEMPLATE_VERSION,
    p: input.paperId,
    v: input.versionId,
    k: input.pdfKey,
    d: input.doi,
    pc: input.primaryCategory,
    cl: [...input.crossListings].sort(),
    l: input.license,
    t: input.title,
    ts: input.postedAt,
    trust: input.trust,
  });
  return createHash('sha256').update(canon).digest('hex');
}

type ContentTrustSignals = Pick<
  TrustPassportInputs,
  | 'hasReferenceSection'
  | 'citationMarkerCount'
  | 'referenceEntryCount'
  | 'resolvedReferenceCount'
  | 'mathHeavy'
  | 'mathExpressionCount'
  | 'theoremLikeCount'
>;

async function buildCoverInput(
  ctx: AppContext,
  loaded: PaperWithRelations,
  version: PaperVersionRecord,
): Promise<CoverInput> {
  const [contentSignals, provenanceCompletion] = await Promise.all([
    contentTrustSignals(ctx, loaded, version),
    coverProvenanceCompletion(ctx, loaded, version),
  ]);
  const trustPassport = computeTrustPassport({
    hasDisclosure: Boolean(loaded.disclosure),
    disclosureLevel: loaded.disclosure?.level,
    disclosureHumanVerified: Boolean(loaded.disclosure?.humanVerified),
    disclosedModelCount: loaded.disclosure?.models.length ?? 0,
    hasPlainSummary: loaded.summaries.length > 0,
    hasAnyOrcid: loaded.authors.some((a) => Boolean(a.orcid?.trim())),
    submitterDidValid: /^did:(plc|web):[a-z0-9._:%-]+$/i.test(loaded.paper.submitterDid),
    authorCount: loaded.authors.length,
    identifiedAuthorCount: loaded.authors.filter((a) => Boolean(a.orcid?.trim() || a.did?.trim()))
      .length,
    hasSourceArchive: Boolean(version.sourceKey),
    hasCompiledPdf: Boolean(version.pdfKey || version.finalPdfUrl),
    hasHtmlRendering: Boolean(version.htmlKey),
    hasFileHash: Boolean(version.fileSha256),
    provenanceCompletion,
    detectorScore: loaded.detectorScore?.score ?? null,
    endorsementCount: 0,
    distinctEndorsementVerbs: 0,
    ...contentSignals,
  });
  const trust: CoverInput['trust'] = {
    transparency: trustPassport.transparency.state,
    identity: trustPassport.identity.state,
    provenance: trustPassport.provenance.state,
    citations: trustPassport.citations.state,
    math: trustPassport.math.state,
    integrity: trustPassport.integrity.state,
  };
  return {
    openxivId: loaded.paper.openxivId ?? loaded.paper.id,
    openxivUrlId: loaded.paper.openxivId
      ? openxivIdToUrl(loaded.paper.openxivId)
      : loaded.paper.id,
    title: loaded.paper.title,
    abstract: loaded.paper.abstract,
    authors: loaded.authors.map((a) => ({
      displayName: a.displayName,
      affiliation: a.affiliation,
      orcid: a.orcid,
    })),
    primaryCategory: loaded.paper.primaryCategory,
    crossListings: loaded.paper.crossListings ?? [],
    license: loaded.paper.license,
    version: version.versionNumber,
    postedAt: (loaded.paper.publishedAt ?? loaded.paper.createdAt).toISOString(),
    doi: loaded.paper.doi,
    disclosureLevel: loaded.disclosure?.level ?? null,
    trust,
    publicBase: PUBLIC_BASE,
  };
}

async function coverProvenanceCompletion(
  ctx: AppContext,
  loaded: PaperWithRelations,
  version: PaperVersionRecord,
): Promise<number | null> {
  const sectionsFirstIndexed = await ctx.repos.sections.firstIndexedAt(loaded.paper.id);
  const sectionsFirstIndexedAt = sectionsFirstIndexed.isOk() ? sectionsFirstIndexed.value : null;
  const timeline = buildProvenanceTimeline({
    loaded: { ...loaded, latestVersion: version },
    sectionsFirstIndexedAt,
    bridgeDone: version.bridgeStatus === 'posted',
  });
  return timeline.completion;
}

async function contentTrustSignals(
  ctx: AppContext,
  loaded: PaperWithRelations,
  version: PaperVersionRecord,
): Promise<ContentTrustSignals> {
  const empty: ContentTrustSignals = {
    hasReferenceSection: null,
    citationMarkerCount: null,
    referenceEntryCount: null,
    resolvedReferenceCount: null,
    mathHeavy: null,
    mathExpressionCount: null,
    theoremLikeCount: null,
  };

  const result = await ctx.repos.sections.forPaper(loaded.paper.id);
  const sections: CitationEvidenceSection[] = result.isOk()
    ? result.value.map((section) => ({
        title: section.title ?? '',
        content: section.content ?? '',
      }))
    : [];
  if (sections.length === 0 && !version.sourceKey) return empty;

  const citationSections = await loadBestCitationSections(ctx, version, sections);
  const citationEvidence = extractCitationContentEvidence(citationSections);
  const allText = [
    loaded.paper.title,
    loaded.paper.abstract ?? '',
    ...sections.flatMap((section) => [section.title, section.content]),
    ...(sections.length === 0 ? citationSections.flatMap((section) => [section.title, section.content]) : []),
  ].join('\n');
  const mathExpressionCount = countMathExpressions(allText);
  const theoremLikeCount = countTheoremLikeCues(allText);
  const categories = [
    loaded.paper.primaryCategory,
    ...(loaded.paper.crossListings ?? []),
    ...loaded.categories,
  ].filter(Boolean);

  return {
    ...citationEvidence,
    mathHeavy:
      categories.some((category) => /^math(?:\.|-|$)|math-ph/i.test(category)) ||
      mathExpressionCount >= 4 ||
      theoremLikeCount >= 2,
    mathExpressionCount,
    theoremLikeCount,
  };
}

async function loadBestCitationSections(
  ctx: AppContext,
  version: PaperVersionRecord,
  indexedSections: CitationEvidenceSection[],
): Promise<CitationEvidenceSection[]> {
  const indexedEvidence = extractCitationContentEvidence(indexedSections);
  if (!shouldTrySourceCitationFallback(indexedEvidence)) return indexedSections;

  const sourceSections = await loadSourceCitationSections(ctx, version);
  if (sourceSections.length === 0) return indexedSections;

  const sourceEvidence = extractCitationContentEvidence(sourceSections);
  return isCitationEvidenceBetter(sourceEvidence, indexedEvidence) ? sourceSections : indexedSections;
}

async function loadSourceCitationSections(
  ctx: AppContext,
  version: PaperVersionRecord,
): Promise<CitationEvidenceSection[]> {
  const sourceKey = version.sourceKey;
  if (!sourceKey) return [];

  const source = await ctx.clients.storage.get(sourceKey);
  if (source.isErr()) return [];

  try {
    const filename = sourceKey.split('/').pop() ?? 'source.tex';
    const files = await extractToFileNodes(source.value.body, filename);
    return extractCitationSectionsFromSourceFiles(files);
  } catch {
    return [];
  }
}

function shouldTrySourceCitationFallback(evidence: CitationContentEvidence): boolean {
  return (
    evidence.hasReferenceSection !== true ||
    (evidence.citationMarkerCount ?? 0) === 0 ||
    (evidence.referenceEntryCount ?? 0) === 0 ||
    (evidence.resolvedReferenceCount ?? 0) === 0
  );
}

function isCitationEvidenceBetter(
  candidate: CitationContentEvidence,
  current: CitationContentEvidence,
): boolean {
  const candidateRank = citationEvidenceRank(candidate);
  const currentRank = citationEvidenceRank(current);
  for (let i = 0; i < candidateRank.length; i += 1) {
    if (candidateRank[i]! > currentRank[i]!) return true;
    if (candidateRank[i]! < currentRank[i]!) return false;
  }
  return false;
}

function citationEvidenceRank(evidence: CitationContentEvidence): number[] {
  return [
    evidence.resolvedReferenceCount ?? 0,
    evidence.referenceEntryCount ?? 0,
    evidence.hasReferenceSection === true ? 1 : 0,
    evidence.citationMarkerCount ?? 0,
  ];
}

function countRegex(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return text.match(new RegExp(pattern.source, flags))?.length ?? 0;
}

function countMathExpressions(text: string): number {
  return (
    countRegex(
      text,
      /\\(?:begin\{(?:equation|align|gather|multline)\*?\}|frac|sum|int|prod|partial|nabla|sqrt|alpha|beta|gamma|delta|lambda|mu|nu|rho|sigma|omega|Omega|mathbb|mathbf)\b/g,
    ) +
    countRegex(text, /<math[\s>]/gi) +
    countRegex(text, /(?:\$\$?[^$\n]{1,200}\$\$?|\\\([^)]{1,200}\\\)|\\\[[\s\S]{1,500}\\\])/g) +
    countRegex(text, /\b[A-Za-z][A-Za-z0-9]*\s*=\s*[-+*/^_{}A-Za-z0-9\\ ]{2,80}/g) +
    countRegex(text, /[A-Za-z0-9)\]}]\s*[\^_]\s*(?:\{[^}]{1,30}}|[A-Za-z0-9+-]+)/g)
  );
}

function countTheoremLikeCues(text: string): number {
  return countRegex(
    text,
    /\b(theorem|lemma|proposition|corollary|proof|definition|claim|equation|invariant|derivation)\b/gi,
  );
}

// MinIO I/O is small enough to inline here — pulling in the storage
// client wrapper would couple this orchestrator to the global state.
async function downloadFromMinio(ctx: AppContext, key: string): Promise<Buffer> {
  const storage = ctx.clients.storage;
  const r = await storage.get(key);
  if (r.isErr()) throw r.error;
  return r.value.body;
}

async function uploadToMinio(ctx: AppContext, key: string, body: Buffer): Promise<void> {
  const storage = ctx.clients.storage;
  const r = await storage.put(key, body, { contentType: 'application/pdf' });
  if (r.isErr()) throw r.error;
}

async function persistFinalUrl(
  ctx: AppContext,
  versionId: string,
  url: string,
  hash: string,
): Promise<void> {
  const r = await ctx.repos.papers.setFinalPdf(versionId, { url, contentHash: hash });
  if (r.isErr()) throw r.error;
}
