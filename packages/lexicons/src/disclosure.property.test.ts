import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ATTESTATION_VALUE, AI_USES, DISCLOSURE_LEVELS, disclosureRecordSchema } from './index.js';

const baseUri = 'at://did:plc:abcdefghijklmnopqrstuvwx/app.openxiv.paper/3kabcdef12345';
const isoDate = () => new Date().toISOString();

describe('disclosure property-based invariants', () => {
  it('non-"none" levels require at least one aiUsed and one model', () => {
    const nonNoneLevels = DISCLOSURE_LEVELS.filter((l) => l !== 'none');
    fc.assert(
      fc.property(fc.constantFrom(...nonNoneLevels), (level) => {
        const result = disclosureRecordSchema.safeParse({
          paperUri: baseUri,
          level,
          aiUsed: [],
          models: [],
          attestation: ATTESTATION_VALUE,
          createdAt: isoDate(),
        });
        return result.success === false;
      }),
    );
  });

  it('"none" with empty aiUsed always parses', () => {
    expect(
      disclosureRecordSchema.safeParse({
        paperUri: baseUri,
        level: 'none',
        aiUsed: [],
        models: [],
        attestation: ATTESTATION_VALUE,
        createdAt: isoDate(),
      }).success,
    ).toBe(true);
  });

  it('"none" with any non-empty aiUsed always rejects', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...AI_USES), { minLength: 1, maxLength: 4 }),
        (used) => {
          const result = disclosureRecordSchema.safeParse({
            paperUri: baseUri,
            level: 'none',
            aiUsed: used,
            models: [],
            attestation: ATTESTATION_VALUE,
            createdAt: isoDate(),
          });
          return result.success === false;
        },
      ),
    );
  });

  it('non-"none" with both aiUsed and models always parses', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('assistant' as const, 'coauthor' as const, 'primary' as const),
        fc.array(fc.constantFrom(...AI_USES), { minLength: 1, maxLength: 4 }),
        fc.array(
          fc.record({ name: fc.string({ minLength: 1, maxLength: 50 }) }),
          { minLength: 1, maxLength: 3 },
        ),
        (level, used, models) => {
          const result = disclosureRecordSchema.safeParse({
            paperUri: baseUri,
            level,
            aiUsed: used,
            models,
            attestation: ATTESTATION_VALUE,
            createdAt: isoDate(),
          });
          return result.success === true;
        },
      ),
    );
  });
});
