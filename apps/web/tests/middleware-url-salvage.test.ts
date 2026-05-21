import { describe, expect, it } from 'vitest';
import {
  decodeUntilStable,
  isMultiplyEncoded,
  salvageProfilePath,
} from '../src/lib/url-salvage.js';

/**
 * Unit tests for the URL-salvage middleware. We can't easily spin Astro's
 * onRequest in vitest, but the pure helpers carry the load: the middleware
 * itself is a thin wrapper that calls these and emits a 301. Production
 * smoke test (`apps/api/src/routes/profiles.integration.test.ts` + a
 * Playwright run against the built node adapter) covers the wire path.
 */

describe('decodeUntilStable', () => {
  it('returns plain input unchanged', () => {
    expect(decodeUntilStable('alice')).toBe('alice');
    expect(decodeUntilStable('did:plc:abc')).toBe('did:plc:abc');
  });

  it('decodes single percent-encoding', () => {
    expect(decodeUntilStable('did%3Aplc%3Aabc')).toBe('did:plc:abc');
  });

  it('decodes double percent-encoding (production-bug shape)', () => {
    expect(
      decodeUntilStable('did%253Aweb%253Aopenxiv.local%253Aorcid.0009-0003-6027-7837'),
    ).toBe('did:web:openxiv.local:orcid.0009-0003-6027-7837');
  });

  it('decodes triple+ encoding up to the depth cap (5)', () => {
    expect(decodeUntilStable('did%25253Aplc%25253Aabc')).toBe('did:plc:abc');
  });

  it('survives invalid percent-encoding without throwing', () => {
    const bad = 'foo%ZZbar';
    expect(decodeUntilStable(bad)).toBe(bad);
  });

  it('caps at 5 decode passes (DOS resistance)', () => {
    // 100 nested %25 passes shouldn't loop indefinitely.
    const start = Date.now();
    const adversarial = 'x' + '%25'.repeat(100);
    decodeUntilStable(adversarial);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('isMultiplyEncoded', () => {
  it('detects %25 markers', () => {
    expect(isMultiplyEncoded('did%253Aabc')).toBe(true);
    expect(isMultiplyEncoded('did%25abc')).toBe(true);
  });

  it('returns false for single-encoding', () => {
    expect(isMultiplyEncoded('did%3Aplc%3Aabc')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(isMultiplyEncoded('alice')).toBe(false);
    expect(isMultiplyEncoded('did:plc:abc')).toBe(false);
  });
});

describe('salvageProfilePath', () => {
  it('returns null when path does not target /u/ or /@', () => {
    expect(salvageProfilePath('/about')).toBeNull();
    expect(salvageProfilePath('/papers/abc')).toBeNull();
    expect(salvageProfilePath('/')).toBeNull();
  });

  it('returns null when slug is not multiply-encoded', () => {
    expect(salvageProfilePath('/u/alice')).toBeNull();
    expect(salvageProfilePath('/u/did%3Aplc%3Aabc')).toBeNull();
    expect(salvageProfilePath('/@alice')).toBeNull();
  });

  it('salvages the exact production-bug URL', () => {
    expect(
      salvageProfilePath(
        '/u/did%253Aweb%253Aopenxiv.local%253Aorcid.0009-0003-6027-7837',
      ),
    ).toBe('/u/did%3Aweb%3Aopenxiv.local%3Aorcid.0009-0003-6027-7837');
  });

  it('salvages the @-prefix form', () => {
    expect(
      salvageProfilePath('/@did%253Aweb%253Aopenxiv.local%253Aabc'),
    ).toBe('/@did%3Aweb%3Aopenxiv.local%3Aabc');
  });

  it('preserves nested path tails (future-safe)', () => {
    expect(
      salvageProfilePath('/u/did%253Aplc%253Aabc/posts'),
    ).toBe('/u/did%3Aplc%3Aabc/posts');
  });

  it('returns null when decoding does not change the segment', () => {
    expect(salvageProfilePath('/u/already-clean')).toBeNull();
    // Pathological case: %25 present but decode is a no-op past depth.
    const path = '/u/' + '%25'.repeat(100);
    // Will be decoded as far as the cap allows; salvage returns the
    // best-effort clean form rather than failing.
    const out = salvageProfilePath(path);
    expect(out === null || out.startsWith('/u/')).toBe(true);
  });
});
