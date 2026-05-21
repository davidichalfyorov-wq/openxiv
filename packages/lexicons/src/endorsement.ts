import { z } from 'zod';
import { atUriSchema, datetimeSchema } from './common.js';

export const ENDORSEMENT_LEX_ID = 'app.openxiv.endorsement' as const;

/**
 * Endorsement verbs are typed reviewer-actions, not generic "likes".
 * Each verb signals *what* the endorser did with the paper — important
 * because "I read the abstract and it sounds cool" and "I re-derived the
 * main theorem" carry very different weight, and our Trust Passport
 * surfaces the diversity of verbs that a paper has accumulated.
 *
 * Order matters: most-rigorous first, so UI sort by index gives a tidy
 * descending "what was done here" list.
 */
export const ENDORSEMENT_VERBS = [
  'verified_derivation',
  'checked_references',
  'reproduced_result',
  'useful_background',
  'important_but_flawed',
  'needs_correction',
] as const;

export type EndorsementVerb = (typeof ENDORSEMENT_VERBS)[number];

export const endorsementVerbSchema = z.enum(ENDORSEMENT_VERBS);

export const ENDORSEMENT_VERB_LABEL: Record<EndorsementVerb, string> = {
  verified_derivation: 'Verified derivation',
  checked_references: 'Checked references',
  reproduced_result: 'Reproduced result',
  useful_background: 'Useful background',
  important_but_flawed: 'Important but flawed',
  needs_correction: 'Needs correction',
};

export const ENDORSEMENT_VERB_DESCRIPTION: Record<EndorsementVerb, string> = {
  verified_derivation: 'Worked through the math or proofs and they hold.',
  checked_references: 'Spot-checked the cited literature for accuracy.',
  reproduced_result: 'Ran the experiment or computation and got matching numbers.',
  useful_background: 'Read it; useful context for my own work.',
  important_but_flawed: 'Worth reading despite known problems.',
  needs_correction: 'Identified a concrete error or omission.',
};

export const endorsementRecordSchema = z.object({
  $type: z.literal(ENDORSEMENT_LEX_ID).optional(),
  paperUri: atUriSchema,
  verb: endorsementVerbSchema,
  note: z.string().max(500).optional(),
  createdAt: datetimeSchema,
});

export type EndorsementRecord = z.infer<typeof endorsementRecordSchema>;
