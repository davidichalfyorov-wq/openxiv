import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { OPENXIV_ISSN, isValidIssn, issnPortalUrl, issnUrn } from './issn.js';

describe('OPENXIV_ISSN constant', () => {
  it('is the registered ISSN 3120-9556', () => {
    expect(OPENXIV_ISSN).toBe('3120-9556');
  });

  it('passes its own check-digit validator (canary against typos)', () => {
    expect(isValidIssn(OPENXIV_ISSN)).toBe(true);
  });
});

describe('isValidIssn check digit', () => {
  it('accepts well-known real ISSNs', () => {
    // Nature 0028-0836, Science 0036-8075, PLoS ONE 1932-6203
    expect(isValidIssn('0028-0836')).toBe(true);
    expect(isValidIssn('0036-8075')).toBe(true);
    expect(isValidIssn('1932-6203')).toBe(true);
  });

  it('accepts the X check digit case', () => {
    // To produce an X check digit we need the weighted sum mod 11 = 1.
    // d7=6 with all other digits zero gives sum = 2*6 = 12 → 12 mod 11 = 1
    // → check digit = (11-1) mod 11 = 10 = X. So `0000-006X` is valid.
    expect(isValidIssn('0000-006X')).toBe(true);
    // The non-X variant with the same prefix has the wrong check digit.
    expect(isValidIssn('0000-0060')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isValidIssn('')).toBe(false);
    expect(isValidIssn('3120-9556 ')).toBe(false); // trailing space
    expect(isValidIssn('31209556')).toBe(false); // missing hyphen
    expect(isValidIssn('3120-95566')).toBe(false); // 9 chars
    expect(isValidIssn('abcd-efgh')).toBe(false);
    expect(isValidIssn('0028-0837')).toBe(false); // bad check digit
  });

  it('property: a random 7-digit prefix yields exactly one valid check digit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999 }), (n) => {
        const digits = n.toString().padStart(7, '0');
        let validCount = 0;
        for (const candidate of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'X']) {
          const issn = `${digits.slice(0, 4)}-${digits.slice(4)}${candidate}`;
          if (isValidIssn(issn)) validCount += 1;
        }
        // Exactly one of the 11 possible suffixes is valid.
        expect(validCount).toBe(1);
      }),
      { numRuns: 200 },
    );
  });
});

describe('issnUrn / issnPortalUrl', () => {
  it('emits urn:issn:NNNN-NNNN by default', () => {
    expect(issnUrn()).toBe('urn:issn:3120-9556');
  });

  it('lets callers override the issn (for parsing external metadata)', () => {
    expect(issnUrn('0028-0836')).toBe('urn:issn:0028-0836');
  });

  it('emits the canonical portal URL', () => {
    expect(issnPortalUrl()).toBe('https://portal.issn.org/resource/ISSN/3120-9556');
  });
});
