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

const disclosureSchema = z.object({
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
});

const authorSchema = z.object({
  displayName: z.string().min(1).max(200),
  orcid: z.string().regex(ORCID_REGEX, 'orcid must be 0000-0000-0000-000X').optional(),
  affiliation: z.string().max(200).optional(),
  did: z.string().max(256).optional(),
  isCorresponding: z.boolean().optional(),
});

const summarySchema = z.object({
  tier: z.enum(['school', 'undergrad', 'expert']).default('undergrad'),
  text: z.string().min(80).max(4000),
  aiGenerated: z.boolean().default(false),
  aiModel: z.string().min(1).max(120).optional(),
});

function hasDistinctSummaryTiers(summaries: Array<{ tier: string }>): boolean {
  return new Set(summaries.map((summary) => summary.tier)).size === summaries.length;
}

const metaSchema = z.object({
  title: z.string().min(4).max(500),
  abstract: z.string().max(8000).optional(),
  license: z
    .string()
    .max(100)
    .refine((l) => ALLOWED_LICENSES.includes(l), { message: 'license must be an SPDX identifier from the allowlist' }),
  primaryCategory: z.string().refine((c) => CATEGORY_CODES.includes(c), {
    message: 'unknown category',
  }),
  secondaryCategories: z.array(z.string()).max(5).default([]),
  authors: z.array(authorSchema).min(1).max(50),
  disclosure: disclosureSchema,
  summary: summarySchema.optional(),
  summaries: z
    .array(summarySchema)
    .min(1)
    .max(3)
    .refine(hasDistinctSummaryTiers, { message: 'summary tiers must be unique' })
    .optional(),
  // Author must accept the current submission terms — same literal+version
  // pin as the wizard's finalize path.
  submissionTerms: z.object({
    version: z.literal(SUBMISSION_TERMS_VERSION),
    attestation: z.literal(SUBMISSION_TERMS_ATTESTATION),
  }),
}).refine((body) => body.summary !== undefined || (body.summaries?.length ?? 0) > 0, {
  message: 'at least one summary is required',
  path: ['summaries'],
});

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/x-tex',
  'text/x-tex',
  'application/x-latex',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/zip',
  // Windows-spawned uploads (File Explorer drag, legacy IE) send the
  // non-standard `x-zip-compressed`. Identical to application/zip.
  'application/x-zip-compressed',
  'application/octet-stream', // many browsers send this for .tex/.tar.gz
]);

const ALLOWED_EXT = /\.(pdf|tex|tar\.gz|tgz|zip)$/i;

function validateSource(filename: string, mimetype: string, byteLength: number): void {
  if (byteLength === 0) throw Errors.validation('source file is empty');
  if (byteLength > 100 * 1024 * 1024) throw Errors.validation('source exceeds 100MB');
  if (!ALLOWED_EXT.test(filename)) {
    throw Errors.validation('source must be one of: .pdf, .tex, .tar.gz, .tgz, .zip');
  }
  if (!ALLOWED_MIME.has(mimetype)) {
    throw Errors.validation(`source mimetype not allowed: ${mimetype}`);
  }
}

export async function uploadsRoutes(app: FastifyInstance): Promise<void> {
  const services = app.services;

  app.post(
    '/submissions',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'Submit a new paper draft. Multipart with `source` file and `meta` JSON field.',
      },
    },
    async (req, reply) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.canSubmit(req.session.did)) {
        throw Errors.forbidden('this DID is not in the submit allowlist');
      }

      let metaJson: string | undefined;
      let source:
        | {
            filename: string;
            mimetype: string;
            buffer: Buffer;
          }
        | undefined;

      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'source') {
          const buf = await streamToBuffer(part.file);
          source = { filename: part.filename, mimetype: part.mimetype, buffer: buf };
        } else if (part.type === 'field' && part.fieldname === 'meta') {
          if (typeof part.value !== 'string') {
            throw Errors.validation('meta must be a string field');
          }
          if (part.value.length > 1024 * 1024) {
            throw Errors.validation('meta JSON exceeds 1MB');
          }
          metaJson = part.value;
        }
      }

      if (!source) throw Errors.validation('missing field: source');
      if (!metaJson) throw Errors.validation('missing field: meta (JSON-encoded)');
      validateSource(source.filename, source.mimetype, source.buffer.length);

      let metaParsed: unknown;
      try {
        metaParsed = JSON.parse(metaJson);
      } catch {
        throw Errors.validation('meta must be JSON');
      }
      const meta = metaSchema.parse(metaParsed);

      const result = await services.submissions.submitDraft({
        submitterDid: req.session.did,
        title: meta.title,
        abstract: meta.abstract,
        license: meta.license,
        primaryCategory: meta.primaryCategory,
        secondaryCategories: meta.secondaryCategories,
        authors: meta.authors,
        source: { bytes: source.buffer, filename: source.filename },
        disclosure: meta.disclosure,
        submissionTermsVersion: meta.submissionTerms.version,
        summaries: meta.summaries ?? (meta.summary ? [meta.summary] : []),
      });
      if (result.isErr()) throw result.error;
      reply.status(201);
      return result.value;
    },
  );
}

export const __testing = {
  metaSchema,
};

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
