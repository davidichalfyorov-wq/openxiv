import { describe, expect, it } from 'vitest';
import {
  SUBMISSION_TERMS_ATTESTATION,
  SUBMISSION_TERMS_VERSION,
} from '@openxiv/shared';
import { __testing } from './intake.js';

const summaryText = (label: string) =>
  `${label} `.repeat(18).trim() +
  ' with enough substance to satisfy the plain-language summary gate.';

function validFinalizeBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    title: 'Submission schema accepts tiered summaries',
    abstract: 'An abstract.',
    license: 'CC-BY-4.0',
    primaryCategory: 'cs.AI',
    crossListings: [],
    authors: [{ displayName: 'A. Author', isCorresponding: true }],
    keywords: ['summary'],
    disclosure: {
      level: 'assistant',
      aiUsed: ['summary'],
      models: [{ name: 'deepseek-v4-flash' }],
      summaryAiGenerated: true,
      attestation: 'i-attest-this-disclosure-is-accurate',
    },
    summaries: [
      {
        tier: 'school',
        text: summaryText('School'),
        aiGenerated: true,
        aiModel: 'deepseek-v4-flash',
      },
      {
        tier: 'undergrad',
        text: summaryText('Undergrad'),
        aiGenerated: true,
        aiModel: 'deepseek-v4-flash',
      },
      {
        tier: 'expert',
        text: summaryText('Expert'),
        aiGenerated: true,
        aiModel: 'deepseek-v4-flash',
      },
    ],
    submissionTerms: {
      version: SUBMISSION_TERMS_VERSION,
      attestation: SUBMISSION_TERMS_ATTESTATION,
    },
    ...overrides,
  };
}

describe('finalizeBodySchema tiered summaries', () => {
  it('accepts one to three distinct tier summaries in the intake finalize API', () => {
    const parsed = __testing.finalizeBodySchema.safeParse(validFinalizeBody());

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.summaries?.map((s) => s.tier)).toEqual([
        'school',
        'undergrad',
        'expert',
      ]);
    }
  });

  it('accepts a single summary tier in the intake finalize API', () => {
    const parsed = __testing.finalizeBodySchema.safeParse(
      validFinalizeBody({
        summaries: [
          {
            tier: 'undergrad',
            text: summaryText('Undergrad only'),
            aiGenerated: false,
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it('rejects finalization with no summary tiers', () => {
    const parsed = __testing.finalizeBodySchema.safeParse(
      validFinalizeBody({
        summaries: undefined,
        summary: undefined,
      }),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message === 'at least one summary is required')).toBe(true);
    }
  });

  it('rejects duplicate summary tiers before the service reaches the DB upsert', () => {
    const parsed = __testing.finalizeBodySchema.safeParse(
      validFinalizeBody({
        summaries: [
          { tier: 'school', text: summaryText('School A'), aiGenerated: true },
          { tier: 'school', text: summaryText('School B'), aiGenerated: true },
        ],
      }),
    );

    expect(parsed.success).toBe(false);
  });
});

describe('intake upload rejections', () => {
  it('uses structured source_required user messages for disabled PDF/source uploads', () => {
    const payload = __testing.sourceRequiredPayload();

    expect(payload.error_code).toBe('source_required');
    expect(payload.user_message.title).toMatch(/LaTeX source/i);
  });
});
