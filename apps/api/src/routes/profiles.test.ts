import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalDidVariants, normalizeProfileIdentifier } from './profiles.js';

/**
 * Unit tests for the profile route's input-sanitisation helpers. The
 * live integration test (`profiles.integration.test.ts`) exercises the
 * full Fastify handler against the production input that caused the
 * 404 we are fixing.
 */

describe('normalizeProfileIdentifier', () => {
  it('returns the same string when nothing is percent-encoded', () => {
    expect(normalizeProfileIdentifier('alice')).toBe('alice');
    expect(normalizeProfileIdentifier('did:plc:abcdef')).toBe('did:plc:abcdef');
  });

  it('decodes a singly-encoded DID', () => {
    expect(normalizeProfileIdentifier('did%3Aplc%3Aabc')).toBe('did:plc:abc');
  });

  it('decodes the exact production-bug input (double-encoded)', () => {
    const input = 'did%253Aweb%253Aopenxiv.local%253Aorcid.0009-0003-6027-7837';
    expect(normalizeProfileIdentifier(input)).toBe(
      'did:web:openxiv.local:orcid.0009-0003-6027-7837',
    );
  });

  it('handles triple+ encoded chains', () => {
    expect(normalizeProfileIdentifier('did%25253Aplc%25253Aabc')).toBe('did:plc:abc');
  });

  it('stops cleanly on invalid percent-encoding sequences', () => {
    // %ZZ is not a valid escape — decodeURIComponent throws. The
    // helper must catch and return the input as-is, never crash.
    const bad = 'foo%ZZbar';
    expect(normalizeProfileIdentifier(bad)).toBe(bad);
  });

  it('property: a decoded identifier is idempotent on re-decode', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(
            'alice',
            'did:plc:abc',
            'did:web:openxiv.net:u:orcid.0009',
            'mock-orcid-user',
          ),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !/[%\s]/.test(s)),
        ),
        (input) => {
          const once = normalizeProfileIdentifier(input);
          const twice = normalizeProfileIdentifier(once);
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('canonicalDidVariants', () => {
  it('returns [did] for canonical did:plc', () => {
    expect(canonicalDidVariants('did:plc:abc')).toEqual(['did:plc:abc']);
  });

  it('returns [did] for canonical did:web:openxiv.net', () => {
    expect(canonicalDidVariants('did:web:openxiv.net:u:orcid.0009')).toEqual([
      'did:web:openxiv.net:u:orcid.0009',
    ]);
  });

  it('expands legacy openxiv.local DID to both the legacy and canonical forms', () => {
    expect(canonicalDidVariants('did:web:openxiv.local:orcid.0009-0003-6027-7837')).toEqual([
      'did:web:openxiv.local:orcid.0009-0003-6027-7837',
      'did:web:openxiv.net:u:orcid.0009-0003-6027-7837',
    ]);
  });

  it('property: a non-legacy DID yields a single-variant array', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ minLength: 8 }).map((s) => `did:plc:${s.replace(/[^a-z]/g, 'a')}`),
          fc.string({ minLength: 1 }).map((s) => `did:web:openxiv.net:u:${s.replace(/[^a-z0-9._-]/g, 'a')}`),
        ),
        (did) => {
          expect(canonicalDidVariants(did)).toHaveLength(1);
        },
      ),
      { numRuns: 50 },
    );
  });
});
