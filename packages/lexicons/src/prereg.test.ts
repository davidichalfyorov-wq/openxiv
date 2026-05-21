import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PREREG_ATTESTATION, preregRecordSchema } from './prereg.js';

const baseUri = 'at://did:plc:abcdefghijklmnopqrstuvwx/app.openxiv.paper/3kabcdef12345';
const validBase = {
  hypothesis: 'Subjects exposed to X will exhibit Y at p < 0.05.',
  methodPlan: 'Randomised controlled trial with n=120, preregistered analysis plan...',
  expectedOutcome: 'We expect 40% improvement on the measured outcome variable.',
  registeredAt: '2026-05-17T12:00:00.000Z',
  attestation: PREREG_ATTESTATION,
};

describe('preregRecordSchema', () => {
  it('parses a minimal valid prereg', () => {
    expect(preregRecordSchema.parse(validBase).hypothesis).toContain('p < 0.05');
  });

  it('accepts an optional paperUri', () => {
    const parsed = preregRecordSchema.parse({ ...validBase, paperUri: baseUri });
    expect(parsed.paperUri).toBe(baseUri);
  });

  it('rejects short hypothesis', () => {
    expect(() => preregRecordSchema.parse({ ...validBase, hypothesis: 'too short' })).toThrow();
  });

  it('rejects an unknown attestation', () => {
    expect(() =>
      preregRecordSchema.parse({ ...validBase, attestation: 'i-attest-something-else' }),
    ).toThrow();
  });

  it('property: rejects any combination missing a required field', () => {
    const fields = ['hypothesis', 'methodPlan', 'expectedOutcome', 'attestation', 'registeredAt'] as const;
    fc.assert(
      fc.property(fc.constantFrom(...fields), (missing) => {
        const broken = { ...validBase } as Record<string, unknown>;
        delete broken[missing];
        return preregRecordSchema.safeParse(broken).success === false;
      }),
    );
  });
});
