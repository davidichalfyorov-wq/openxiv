import { z } from 'zod';
import { atUriSchema, datetimeSchema } from './common.js';

export const SUMMARY_LEX_ID = 'app.openxiv.summary' as const;

export const SUMMARY_TIERS = ['school', 'undergrad', 'expert'] as const;
export type SummaryTier = (typeof SUMMARY_TIERS)[number];

export const summaryRecordSchema = z.object({
  $type: z.literal(SUMMARY_LEX_ID).optional(),
  paperUri: atUriSchema,
  tier: z.enum(SUMMARY_TIERS),
  text: z.string().min(80).max(4000),
  aiGenerated: z.boolean().optional().default(false),
  aiModel: z.string().max(100).optional(),
  createdAt: datetimeSchema,
});

export type SummaryRecord = z.infer<typeof summaryRecordSchema>;
