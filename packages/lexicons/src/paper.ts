import { z } from 'zod';
import { atUriSchema, datetimeSchema, didSchema, orcidSchema } from './common.js';

export const PAPER_LEX_ID = 'app.openxiv.paper' as const;
export const PREPRINT_LEX_ID = 'app.openxiv.preprint' as const;

export const LICENSE_VALUES = [
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-ND-4.0',
  'CC0-1.0',
  'arXiv-nonexclusive-distrib',
  'all-rights-reserved',
] as const;

export type License = (typeof LICENSE_VALUES)[number];

export const blobRefSchema = z.object({
  $type: z.literal('blob'),
  ref: z.object({ $link: z.string().min(1) }),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
});

export type BlobRef = z.infer<typeof blobRefSchema>;

export const authorRefSchema = z.object({
  did: didSchema.optional(),
  displayName: z.string().min(1).max(200),
  orcid: orcidSchema.optional(),
  affiliation: z.string().max(200).optional(),
  isCorresponding: z.boolean().optional().default(false),
});

export type AuthorRef = z.infer<typeof authorRefSchema>;

const paperRecordBaseShape = {
  title: z.string().min(4).max(500),
  authors: z.array(authorRefSchema).min(1).max(200),
  categories: z.array(z.string().max(64)).min(1).max(6),
  primaryCategory: z.string().max(64).optional(),
  /**
   * Cross-listings - up to 5 additional categories the paper qualifies
   * for beyond `primaryCategory`. Must not contain `primaryCategory`
   * itself or any duplicates. Mirrors the DB CHECK constraints from
   * migration 0021 so a misbehaving client gets rejected at the
   * lexicon layer before the SQL constraint fires.
   */
  crossListings: z.array(z.string().max(64)).max(5).default([]),
  abstract: z.string().max(8000).optional(),
  keywords: z.array(z.string().max(64)).max(30).optional(),
  license: z.enum(LICENSE_VALUES),
  pdf: blobRefSchema.optional(),
  source: blobRefSchema.optional(),
  html: blobRefSchema.optional(),
  summaryUri: atUriSchema.optional(),
  disclosureUri: atUriSchema.optional(),
  supersedes: atUriSchema.optional(),
  versionNote: z.string().max(500).optional(),
  doi: z.string().max(200).optional(),
  createdAt: datetimeSchema,
};

export const paperRecordSchema = z
  .object({
    $type: z.literal(PAPER_LEX_ID).optional(),
    ...paperRecordBaseShape,
  })
  .refine(
    (paper) => {
      if (!paper.primaryCategory) return true;
      return !paper.crossListings.includes(paper.primaryCategory);
    },
    { message: 'crossListings must not contain primaryCategory' },
  )
  .refine(
    (paper) => new Set(paper.crossListings).size === paper.crossListings.length,
    { message: 'crossListings must not contain duplicates' },
  );

export const preprintRecordSchema = z
  .object({
    $type: z.literal(PREPRINT_LEX_ID).optional(),
    ...paperRecordBaseShape,
  })
  .refine(
    (paper) => {
      if (!paper.primaryCategory) return true;
      return !paper.crossListings.includes(paper.primaryCategory);
    },
    { message: 'crossListings must not contain primaryCategory' },
  )
  .refine(
    (paper) => new Set(paper.crossListings).size === paper.crossListings.length,
    { message: 'crossListings must not contain duplicates' },
  );

export type PaperRecord = z.infer<typeof paperRecordSchema>;
export type PreprintRecord = z.infer<typeof preprintRecordSchema>;
