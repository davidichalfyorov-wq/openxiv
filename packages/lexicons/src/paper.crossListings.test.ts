import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { paperRecordSchema } from './paper.js';

const validBase = {
  title: 'A valid title for property tests',
  authors: [{ displayName: 'A. Author' }],
  categories: ['phys'],
  primaryCategory: 'phys',
  license: 'CC-BY-4.0' as const,
  createdAt: '2026-05-18T00:00:00Z',
};

describe('paperRecordSchema.crossListings', () => {
  it('defaults to empty array when omitted', () => {
    const r = paperRecordSchema.parse(validBase);
    expect(r.crossListings).toEqual([]);
  });

  it('accepts up to 5 distinct cross-listings', () => {
    const r = paperRecordSchema.parse({
      ...validBase,
      crossListings: ['cs', 'math', 'bio', 'q-bio', 'stat'],
    });
    expect(r.crossListings).toHaveLength(5);
  });

  it('rejects more than 5 cross-listings', () => {
    const r = paperRecordSchema.safeParse({
      ...validBase,
      crossListings: ['cs', 'math', 'bio', 'q-bio', 'stat', 'cs.AI'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects cross-listings containing the primary category', () => {
    const r = paperRecordSchema.safeParse({
      ...validBase,
      primaryCategory: 'phys',
      crossListings: ['cs', 'phys'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate cross-listings', () => {
    const r = paperRecordSchema.safeParse({
      ...validBase,
      crossListings: ['cs', 'cs'],
    });
    expect(r.success).toBe(false);
  });

  it('property: any valid set of categories (≤5, distinct, no primary) passes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('cs', 'math', 'bio', 'q-bio', 'stat', 'econ', 'eess', 'cs.AI'), {
          minLength: 0,
          maxLength: 5,
        }),
        (categories) => {
          const distinct = Array.from(new Set(categories)).filter((c) => c !== 'phys');
          const r = paperRecordSchema.safeParse({ ...validBase, crossListings: distinct });
          expect(r.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
