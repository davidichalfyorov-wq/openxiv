import { z } from 'zod';
import { atUriSchema, datetimeSchema } from './common.js';

export const PREREG_LEX_ID = 'app.openxiv.prereg' as const;

export const PREREG_ATTESTATION = 'i-attest-this-prereg-precedes-data-collection' as const;

export const preregRecordSchema = z.object({
  $type: z.literal(PREREG_LEX_ID).optional(),
  paperUri: atUriSchema.optional(),
  title: z.string().max(500).optional(),
  hypothesis: z.string().min(20).max(2000),
  methodPlan: z.string().min(40).max(8000),
  expectedOutcome: z.string().min(20).max(4000),
  primaryCategory: z.string().max(64).optional(),
  registeredAt: datetimeSchema,
  attestation: z.literal(PREREG_ATTESTATION),
});

export type PreregRecord = z.infer<typeof preregRecordSchema>;
