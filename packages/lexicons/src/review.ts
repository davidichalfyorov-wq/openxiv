import { z } from 'zod';
import { atUriSchema, datetimeSchema } from './common.js';

export const REVIEW_LEX_ID = 'app.openxiv.review' as const;

export const REVIEW_VERDICTS = ['positive', 'mixed', 'concerns', 'strong-concerns'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const reviewRecordSchema = z.object({
  $type: z.literal(REVIEW_LEX_ID).optional(),
  paperUri: atUriSchema,
  text: z.string().min(50).max(20000),
  verdict: z.enum(REVIEW_VERDICTS).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  isReviewerExpert: z.boolean().optional().default(false),
  createdAt: datetimeSchema,
});

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
