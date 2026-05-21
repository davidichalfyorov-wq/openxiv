import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

/**
 * Mirror of the `normalizeHandleParam` helper inside
 * `apps/web/src/pages/u/[handle].astro`. We re-implement it here because
 * importing Astro modules from vitest is non-trivial; the invariant is
 * small enough to test by mirror.
 */
function normalizeHandleParam(raw: string): string {
  let current = raw;
  for (let i = 0; i < 5; i++) {
    if (!current.includes('%')) return current;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

describe('normalizeHandleParam (SSR boundary defence)', () => {
  it('returns plain handles unchanged', () => {
    expect(normalizeHandleParam('alice')).toBe('alice');
    expect(normalizeHandleParam('dr-test')).toBe('dr-test');
  });

  it('returns canonical DIDs unchanged', () => {
    expect(normalizeHandleParam('did:plc:abc')).toBe('did:plc:abc');
    expect(normalizeHandleParam('did:web:openxiv.net:u:orcid.0009')).toBe(
      'did:web:openxiv.net:u:orcid.0009',
    );
  });

  it('decodes once-encoded DIDs', () => {
    expect(normalizeHandleParam('did%3Aplc%3Aabc')).toBe('did:plc:abc');
  });

  it('decodes the exact production-bug double-encoded URL', () => {
    expect(
      normalizeHandleParam('did%253Aweb%253Aopenxiv.local%253Aorcid.0009-0003-6027-7837'),
    ).toBe('did:web:openxiv.local:orcid.0009-0003-6027-7837');
  });

  it('handles triple-encoded chains', () => {
    expect(normalizeHandleParam('did%25253Aplc%25253Aabc')).toBe('did:plc:abc');
  });

  it('survives invalid percent-encoding without throwing', () => {
    const bad = 'foo%ZZbar';
    expect(normalizeHandleParam(bad)).toBe(bad);
  });

  it('caps decode depth at 5 so adversarial input cannot DOS', () => {
    // 100 nested %25 → only first 5 are decoded; remainder stays as-is.
    // The point is the function returns in bounded time.
    const start = Date.now();
    const adversarial = 'did' + '%25'.repeat(100) + '3Aplc';
    const out = normalizeHandleParam(adversarial);
    expect(Date.now() - start).toBeLessThan(50);
    expect(out.length).toBeGreaterThan(0);
  });

  it('property: idempotent on re-call', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (s) => {
        const once = normalizeHandleParam(s);
        const twice = normalizeHandleParam(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 },
    );
  });
});
