import { z } from 'zod';
import { atUriSchema, datetimeSchema } from './common.js';

export const CITATION_LEX_ID = 'app.openxiv.citation' as const;

export const citationTargetSchema = z
  .object({
    paperUri: atUriSchema.optional(),
    doi: z.string().max(200).optional(),
    arxivId: z.string().max(64).optional(),
  })
  .refine((value) => Boolean(value.paperUri ?? value.doi ?? value.arxivId), {
    message: 'citation must reference at least one of paperUri / doi / arxivId',
  });

export type CitationTarget = z.infer<typeof citationTargetSchema>;

export const citationRecordSchema = z.object({
  $type: z.literal(CITATION_LEX_ID).optional(),
  fromUri: atUriSchema,
  to: citationTargetSchema,
  context: z.string().max(500).optional(),
  createdAt: datetimeSchema,
});

export type CitationRecord = z.infer<typeof citationRecordSchema>;
