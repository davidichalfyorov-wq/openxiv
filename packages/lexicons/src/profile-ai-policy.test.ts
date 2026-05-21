import { describe, expect, it } from 'vitest';
import {
  PROFILE_AI_POLICY_LEX_ID,
  profileAiPolicySchema,
} from './profile-ai-policy.js';

describe('app.openxiv.profileAiPolicy lexicon', () => {
  it('accepts an empty object — every field is optional', () => {
    expect(profileAiPolicySchema.safeParse({}).success).toBe(true);
  });

  it('strips $type during round-trip', () => {
    const parsed = profileAiPolicySchema.parse({
      $type: PROFILE_AI_POLICY_LEX_ID,
      models_used: ['gpt-4'],
    });
    expect(parsed.models_used).toEqual(['gpt-4']);
  });

  it('caps each model name at 120 chars', () => {
    const long = 'x'.repeat(121);
    const r = profileAiPolicySchema.safeParse({ models_used: [long] });
    expect(r.success).toBe(false);
  });

  it('caps models_used array at 20 entries', () => {
    const r = profileAiPolicySchema.safeParse({
      models_used: Array.from({ length: 21 }, (_, i) => `model-${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('caps verification_practice at 2000 chars', () => {
    const r = profileAiPolicySchema.safeParse({
      verification_practice: 'a'.repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it('strips unknown extra fields on parse', () => {
    const parsed = profileAiPolicySchema.parse({
      models_used: ['gpt-4'],
      arbitrary_extra: 'leak',
    } as Record<string, unknown>);
    expect((parsed as { arbitrary_extra?: string }).arbitrary_extra).toBeUndefined();
  });
});
