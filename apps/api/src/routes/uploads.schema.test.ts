import { describe, expect, it } from 'vitest';
import {
  SUBMISSION_TERMS_ATTESTATION,
  SUBMISSION_TERMS_VERSION,
} from '@openxiv/shared';
import { __testing } from './uploads.js';

const summaryText = (label: string) =>
  `${label} `.repeat(18).trim() +
  ' with enough substance to satisfy the plain-language summary gate.';

function validMeta(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Upload schema accepts one plain-language summary',
    abstract: 'An abstract.',
    license: 'CC-BY-4.0',
    primaryCategory: 'cs.AI',
    secondaryCategories: [],
    authors: [{ displayName: 'A. Author', isCorresponding: true }],
    disclosure: {
      level: 'none',
      aiUsed: [],
      models: [],
      summaryAiGenerated: false,
      attestation: 'i-attest-this-disclosure-is-accurate',
    },
    summaries: [
      {
        tier: 'undergrad',
        text: summaryText('Undergrad only'),
        aiGenerated: false,
      },
    ],
    submissionTerms: {
      version: SUBMISSION_TERMS_VERSION,
      attestation: SUBMISSION_TERMS_ATTESTATION,
    },
    ...overrides,
  };
}

describe('uploads metaSchema summary policy', () => {
  it('accepts one filled summary tier', () => {
    const parsed = __testing.metaSchema.safeParse(validMeta());

    expect(parsed.success).toBe(true);
  });

  it('rejects zero summary tiers with the public policy message', () => {
    const parsed = __testing.metaSchema.safeParse(
      validMeta({
        summaries: undefined,
        summary: undefined,
      }),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message === 'at least one summary is required')).toBe(true);
    }
  });
});
