import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CROSS_LISTINGS_MAX,
  sanitizeCrossListings,
} from './cross-listings.js';

const CATALOG = new Set([
  'math.AG',
  'math.AT',
  'math.DG',
  'physics.gen-ph',
  'cs.AI',
  'cs.LG',
  'cs.CL',
  'hep-th',
  'q-bio.NC',
]);

describe('sanitizeCrossListings', () => {
  it('returns empty value for empty input', () => {
    const r = sanitizeCrossListings({ primary: 'cs.AI', crossListings: [], catalog: CATALOG });
    expect(r).toMatchObject({ ok: true, value: [] });
  });

  it('accepts one valid secondary', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['math.AG'],
      catalog: CATALOG,
    });
    expect(r).toMatchObject({ ok: true, value: ['math.AG'] });
  });

  it('accepts the maximum two and sorts them alphabetically', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['physics.gen-ph', 'math.AG'],
      catalog: CATALOG,
    });
    expect(r).toMatchObject({ ok: true, value: ['math.AG', 'physics.gen-ph'] });
  });

  it('rejects three with reason too_many and surfaces the extras', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['math.AG', 'physics.gen-ph', 'cs.LG'],
      catalog: CATALOG,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('too_many');
      expect(r.offenders).toEqual(['cs.LG']);
    }
  });

  it('rejects when a secondary equals the primary', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['cs.AI'],
      catalog: CATALOG,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('overlap');
      expect(r.offenders).toEqual(['cs.AI']);
    }
  });

  it('rejects duplicate secondaries with reason duplicate', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['math.AG', 'math.AG'],
      catalog: CATALOG,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('duplicate');
      expect(r.offenders).toEqual(['math.AG']);
    }
  });

  it('rejects codes not in the catalog with reason invalid_code', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['not.a.real.code'],
      catalog: CATALOG,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid_code');
      expect(r.offenders).toContain('not.a.real.code');
    }
  });

  it('trims whitespace before checking', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['  math.AG  '],
      catalog: CATALOG,
    });
    expect(r).toMatchObject({ ok: true, value: ['math.AG'] });
  });

  it('drops empty-string entries silently', () => {
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['math.AG', '', '  '],
      catalog: CATALOG,
    });
    expect(r).toMatchObject({ ok: true, value: ['math.AG'] });
  });

  it('CROSS_LISTINGS_MAX is exactly 2 (sentinel)', () => {
    expect(CROSS_LISTINGS_MAX).toBe(2);
  });

  it('property: 50 random valid inputs never throw and produce sorted unique arrays of length ≤ 2', () => {
    const all = Array.from(CATALOG);
    fc.assert(
      fc.property(
        fc.constantFrom(...all),
        fc.array(fc.constantFrom(...all), { minLength: 0, maxLength: 5 }),
        (primary, secondaries) => {
          const r = sanitizeCrossListings({ primary, crossListings: secondaries, catalog: CATALOG });
          if (r.ok) {
            expect(r.value.length).toBeLessThanOrEqual(CROSS_LISTINGS_MAX);
            expect(new Set(r.value).size).toBe(r.value.length); // unique
            expect(r.value).not.toContain(primary); // no overlap
            // sorted alphabetically
            for (let i = 1; i < r.value.length; i++) {
              expect(r.value[i - 1]!.localeCompare(r.value[i]!)).toBeLessThanOrEqual(0);
            }
          } else {
            // Every failure path carries non-empty offenders + a known reason
            expect(['overlap', 'duplicate', 'invalid_code', 'too_many']).toContain(r.reason);
            expect(r.offenders.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('property: invalid_code wins over too_many even when both apply', () => {
    // 3 codes, all invalid — invalid_code should fire first (step 1).
    const r = sanitizeCrossListings({
      primary: 'cs.AI',
      crossListings: ['bad1', 'bad2', 'bad3'],
      catalog: CATALOG,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_code');
  });
});
