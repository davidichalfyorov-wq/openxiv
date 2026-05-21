import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ALLOWED_LICENSES,
  CATEGORY_CODES,
  Errors,
  ORCID_REGEX,
  SUBMISSION_TERMS_ATTESTATION,
  SUBMISSION_TERMS_VERSION,
} from '@openxiv/shared';
import {
  CROSS_LISTINGS_MAX,
  sanitizeCrossListings,
} from '../services/cross-listings.js';
import { classifySubmitError, makeSubmitUserError, makeUserError } from '../services/error-messages.js';
import {
  detectEntryTex,
  findReferencedPaths,
  missingCompanions,
  looksLikeManuscript,
} from '../services/tex-detect.js';
import { extractToFileNodes } from '../services/archive-extract.js';

const CATEGORY_SET = new Set(CATEGORY_CODES);

const ALLOWED_MIME = new Set([
  // DISABLED 2026-05 PDF upload; revert when GROBID+Nougat pipeline lands.
  // 'application/pdf',
  'application/x-tex',
  'text/x-tex',
  'application/x-latex',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/zip',
  // Windows IE/legacy and some File Explorer-spawned uploads send the
  // non-standard `x-zip-compressed`. Treated identically to application/zip.
  'application/x-zip-compressed',
  'application/octet-stream',
]);
// DISABLED 2026-05 PDF upload; revert when GROBID+Nougat pipeline lands.
// Old regex: /\.(pdf|tex|tar\.gz|tgz|zip)$/i
const ALLOWED_EXT = /\.(tex|tar\.gz|tgz|zip)$/i;

const summaryBodySchema = z.object({
  tier: z.enum(['school', 'undergrad', 'expert']).default('undergrad'),
  text: z.string().min(80).max(4000),
  aiGenerated: z.boolean().default(false),
  aiModel: z.string().min(1).max(120).optional(),
});

function hasDistinctSummaryTiers(summaries: Array<{ tier: string }>): boolean {
  return new Set(summaries.map((summary) => summary.tier)).size === summaries.length;
}

const finalizeBodySchema = z.object({
  sessionId: z.string().min(1).max(64),
  title: z.string().min(4).max(500),
  abstract: z.string().max(8000).default(''),
  license: z
    .string()
    .max(100)
    .refine((l) => ALLOWED_LICENSES.includes(l), { message: 'license not in allowlist' }),
  primaryCategory: z.string().refine((c) => CATEGORY_CODES.includes(c), {
    message: 'unknown primary category',
  }),
  // Strict cap of 2 lives at the API surface. The lexicon allows up to
  // 5 (floor for forward-compatibility); the DB CHECK is the same floor.
  // Three layers cap independently so a UI bypass cannot widen the
  // policy. Accept both `crossListings` (canonical) and `secondaryCategories`
  // (legacy field name from the pre-multi-category wizard) so a stale
  // browser cache doesn't 400.
  crossListings: z.array(z.string()).max(CROSS_LISTINGS_MAX).optional(),
  secondaryCategories: z.array(z.string()).max(CROSS_LISTINGS_MAX).optional(),
  authors: z
    .array(
      z.object({
        displayName: z.string().min(1).max(200),
        orcid: z.string().regex(ORCID_REGEX, 'orcid must be 0000-0000-0000-000X').optional(),
        affiliation: z.string().max(200).optional(),
        did: z.string().max(256).optional(),
        isCorresponding: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
  keywords: z.array(z.string().min(1).max(64)).max(20).optional(),
  disclosure: z.object({
    level: z.enum(['none', 'assistant', 'coauthor', 'primary']),
    aiUsed: z.array(z.string().min(1).max(120)).max(40).default([]),
    models: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          vendor: z.string().max(120).optional(),
          version: z.string().max(60).optional(),
          usage: z.string().max(500).optional(),
        }),
      )
      .max(20)
      .default([]),
    notes: z.string().max(2000).optional(),
    summaryAiGenerated: z.boolean().default(false),
    attestation: z.literal('i-attest-this-disclosure-is-accurate'),
  }),
  // `summary` is the legacy single-tier shape. `summaries` is the
  // current submission wizard payload: one to three separately generated
  // explainer tiers, each saved under its own DB uniqueness key.
  summary: summaryBodySchema.optional(),
  summaries: z
    .array(summaryBodySchema)
    .min(1)
    .max(3)
    .refine(hasDistinctSummaryTiers, { message: 'summary tiers must be unique' })
    .optional(),
  // Author must read and accept the submission terms. The literal is
  // version-pinned: bumping SUBMISSION_TERMS_VERSION invalidates old
  // attestations, forcing re-acceptance for new submissions while
  // preserving the historical record of who accepted what.
  submissionTerms: z.object({
    version: z.literal(SUBMISSION_TERMS_VERSION),
    attestation: z.literal(SUBMISSION_TERMS_ATTESTATION),
  }),
}).refine((body) => body.summary !== undefined || (body.summaries?.length ?? 0) > 0, {
  message: 'at least one summary is required',
  path: ['summaries'],
});

const suggestBodySchema = z.object({
  sessionId: z.string().min(1),
  tier: z.enum(['school', 'undergrad', 'expert']),
});

export async function intakeRoutes(app: FastifyInstance): Promise<void> {
  const services = app.services;

  /** W1: drop a file → compile + extract → return session id + extracted fields. */
  app.post(
    '/submissions/intake',
    {
      preHandler: app.requireAuth,
      schema: { description: 'Upload-first intake. Multipart with `source` file.' },
    },
    async (req, reply) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.canSubmit(req.session.did)) {
        throw Errors.forbidden('this DID is not in the submit allowlist');
      }

      let source:
        | { filename: string; mimetype: string; buffer: Buffer }
        | undefined;
      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'source') {
          const buf = await streamToBuffer(part.file);
          source = { filename: part.filename, mimetype: part.mimetype, buffer: buf };
        }
      }
      if (!source) {
        // DISABLED 2026-05 PDF upload — structured source_required lets the
        // wizard surface a clear "LaTeX source archive required" message
        // instead of a generic 400.
        reply.status(400);
        return sourceRequiredPayload();
      }
      if (source.buffer.length === 0) throw Errors.validation('source is empty');
      if (source.buffer.length > 100 * 1024 * 1024) {
        throw Errors.validation('source exceeds 100MB');
      }
      if (/\.pdf$/i.test(source.filename)) {
        // Explicit branch: anyone hitting this is uploading a PDF
        // intentionally and deserves a structured rejection instead
        // of a generic mimetype validation error.
        reply.status(400);
        return sourceRequiredPayload();
      }
      if (!ALLOWED_EXT.test(source.filename)) {
        throw Errors.validation(
          'source must be one of: .tex, .tar.gz, .tgz, .zip — PDF-only uploads are disabled',
        );
      }
      if (!ALLOWED_MIME.has(source.mimetype)) {
        throw Errors.validation(`source mimetype not allowed: ${source.mimetype}`);
      }

      // ----- Pre-compile gate: detection + companion check -----
      //
      // Run before we stash the source so the user gets a clear
      // human-readable rejection rather than a saga-level compile
      // failure 30s later. Three terminal outcomes here:
      //
      //   1. Single `.tex` referencing files not in the upload →
      //      `companions_required` with the missing list.
      //   2. Archive with no `\documentclass` anywhere → `no_documentclass`.
      //   3. Archive with multiple `\documentclass` files →
      //      `multiple_documentclass` with the entrypoint list.
      //
      // Anything that survives the gate enters the saga, which
      // wraps the compile / latexml / cover / marker steps in their
      // own try/catch with the same error-message catalogue.
      try {
        if (/\.tex$/i.test(source.filename)) {
          // Single-file upload: parse referenced paths, ensure none
          // are missing.
          const content = source.buffer.toString('utf-8');
          if (!looksLikeManuscript(content)) {
            reply.status(400);
            return makeUserError('no_documentclass');
          }
          const refs = findReferencedPaths(content);
          const missing = missingCompanions(refs, []);
          if (missing.length > 0) {
            reply.status(400);
            return makeUserError('companions_required', { missing_files: missing });
          }
        } else {
          // Archive: extract in-memory, run detector + companion check
          // against the actual presented file tree.
          let files;
          try {
            files = await extractToFileNodes(source.buffer, source.filename);
          } catch {
            reply.status(400);
            return makeUserError('malformed_archive');
          }
          const det = detectEntryTex(files);
          if (!det.ok) {
            reply.status(400);
            if (det.error === 'multiple_documentclass') {
              return makeUserError('multiple_documentclass', { files: det.files });
            }
            return makeUserError('no_documentclass');
          }
          // Companion check on the detected entry's references.
          const refs = findReferencedPaths(det.entry.content);
          const presentPaths = files.map((f) => f.path);
          const missing = missingCompanions(refs, presentPaths);
          if (missing.length > 0) {
            reply.status(400);
            return makeUserError('companions_required', {
              missing_files: missing,
              entry: det.entry.path,
            });
          }
        }
      } catch (preflightErr) {
        // Hard internal failure during pre-flight (disk I/O, OOM…)
        // gets a generic user message — the structured log carries
        // the cause for the operator.
        req.log?.warn(
          { err: preflightErr },
          '[intake] pre-flight gate threw; emitting unknown_error',
        );
        reply.status(500);
        return makeUserError('unknown_error');
      }

      const result = await services.intake.intake({
        bytes: source.buffer,
        filename: source.filename,
      });
      if (result.isErr()) {
        const code = classifySubmitError(result.error);
        if (code === 'unknown_error') throw result.error;
        reply.status(400);
        return makeSubmitUserError(result.error);
      }
      return result.value;
    },
  );

  /** W4 helper: ask the configured text LLM to draft a plain-language summary. */
  app.post(
    '/summaries/suggest',
    {
      preHandler: app.requireAuth,
      schema: { body: suggestBodySchema },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { sessionId, tier } = req.body as z.infer<typeof suggestBodySchema>;
      const result = await services.suggest.forIntake({ sessionId, tier });
      if (result.isErr()) throw result.error;
      return result.value;
    },
  );

  /** W5: commit the edited form, kick off the saga from S3 onwards. */
  app.post(
    '/submissions/finalize',
    {
      preHandler: app.requireAuth,
      schema: { body: finalizeBodySchema },
    },
    async (req, reply) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.canSubmit(req.session.did)) {
        throw Errors.forbidden('this DID is not in the submit allowlist');
      }
      const body = req.body as z.infer<typeof finalizeBodySchema>;

      // crossListings is canonical; legacy clients still send
      // secondaryCategories. Prefer the new field when both are present
      // so a wizard mid-upgrade can't smuggle in stale state.
      const rawCross = body.crossListings ?? body.secondaryCategories ?? [];
      const sanitized = sanitizeCrossListings({
        primary: body.primaryCategory,
        crossListings: rawCross,
        catalog: CATEGORY_SET,
      });
      if (!sanitized.ok) {
        // Return 400 with a structured payload so the UI can render a
        // specific error rather than a generic "validation failed".
        reply.status(400);
        return {
          kind: 'invalid_cross_listing' as const,
          reason: sanitized.reason,
          offenders: sanitized.offenders,
        };
      }

      const result = await services.submissions.finalizeFromIntake({
        submitterDid: req.session.did,
        sessionId: body.sessionId,
        title: body.title,
        abstract: body.abstract,
        license: body.license,
        primaryCategory: body.primaryCategory,
        secondaryCategories: sanitized.value,
        authors: body.authors,
        keywords: body.keywords,
        disclosure: body.disclosure,
        submissionTermsVersion: body.submissionTerms.version,
        summaries: body.summaries ?? (body.summary ? [body.summary] : []),
      });
      if (result.isErr()) throw result.error;
      reply.status(201);
      return result.value;
    },
  );
}

export const __testing = {
  finalizeBodySchema,
  sourceRequiredPayload,
};

function sourceRequiredPayload() {
  return makeUserError('source_required');
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
