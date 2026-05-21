import { z } from 'zod';

export const PROFILE_AI_POLICY_LEX_ID = 'app.openxiv.profileAiPolicy' as const;

/**
 * Public AI-use disclosure attached to an OpenXiv profile. Five fields, all
 * optional — authors describe what they actually do rather than guess.
 *
 * Stored under the user's PDS via this lexicon and mirrored locally in
 * `profile_cards.content_json` (card_type='ai_policy') for fast SSR.
 */
export const profileAiPolicySchema = z.object({
  $type: z.literal(PROFILE_AI_POLICY_LEX_ID).optional(),
  models_used: z.array(z.string().max(120)).max(20).optional(),
  models_avoided: z.array(z.string().max(120)).max(20).optional(),
  use_cases: z.array(z.string().max(240)).max(20).optional(),
  verification_practice: z.string().max(2000).optional(),
  failure_modes: z.string().max(2000).optional(),
});

export type ProfileAiPolicy = z.infer<typeof profileAiPolicySchema>;
