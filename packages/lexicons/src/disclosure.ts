import { z } from 'zod';
import { atUriSchema, datetimeSchema } from './common.js';

export const DISCLOSURE_LEX_ID = 'app.openxiv.disclosure' as const;

export const DISCLOSURE_LEVELS = ['none', 'assistant', 'coauthor', 'primary'] as const;
export type DisclosureLevel = (typeof DISCLOSURE_LEVELS)[number];

export const AI_USES = [
  'ideation',
  'literature',
  'derivation',
  'code',
  'writing',
  'figures',
  'summary',
  'translation',
] as const;
export type AiUse = (typeof AI_USES)[number];

export const ATTESTATION_VALUE = 'i-attest-this-disclosure-is-accurate' as const;

export const modelRefSchema = z.object({
  name: z.string().min(1).max(100),
  vendor: z.string().max(100).optional(),
  version: z.string().max(50).optional(),
  usage: z
    .enum([
      'ideation',
      'literature',
      'derivation',
      'code',
      'writing',
      'figures',
      'summary',
      'translation',
      'other',
    ])
    .optional(),
});

export type ModelRef = z.infer<typeof modelRefSchema>;

export const disclosureRecordSchema = z
  .object({
    $type: z.literal(DISCLOSURE_LEX_ID).optional(),
    paperUri: atUriSchema,
    level: z.enum(DISCLOSURE_LEVELS),
    aiUsed: z.array(z.enum(AI_USES)).max(8).optional(),
    models: z.array(modelRefSchema).max(20).optional(),
    notes: z.string().max(2000).optional(),
    summaryAiGenerated: z.boolean().optional().default(false),
    humanVerified: z.boolean().optional().default(false),
    attestation: z.literal(ATTESTATION_VALUE),
    createdAt: datetimeSchema,
  })
  .superRefine((value, ctx) => {
    // Consistency rule: if level !== 'none' then aiUsed and models must be non-empty.
    if (value.level !== 'none') {
      if (!value.aiUsed || value.aiUsed.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['aiUsed'],
          message: 'aiUsed required when level is not "none"',
        });
      }
      if (!value.models || value.models.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['models'],
          message: 'models required when level is not "none"',
        });
      }
    }
    // Inverse: if level === 'none', forbid populated aiUsed/models so authors cannot mis-claim.
    if (value.level === 'none') {
      if (value.aiUsed && value.aiUsed.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['aiUsed'],
          message: 'aiUsed must be empty when level is "none"',
        });
      }
    }
  });

export type DisclosureRecord = z.infer<typeof disclosureRecordSchema>;
