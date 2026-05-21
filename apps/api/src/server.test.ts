import { describe, expect, it } from 'vitest';
import { __serverTesting } from './server.js';

describe('global rate limit policy', () => {
  const maxFor = __serverTesting.rateLimitMaxForRequest(60);
  const req = (method: string, url: string) => ({ method, url }) as never;

  it('uses a higher ceiling for idempotent public read routes used by SSR pages', () => {
    expect(maxFor(req('GET', '/api/auth/me'), '198.51.100.42')).toBe(600);
    expect(maxFor(req('GET', '/api/papers/openxiv:gr-qc.2026.00001'), '198.51.100.42')).toBe(600);
    expect(maxFor(req('GET', '/api/papers/paper-1/versions'), '198.51.100.42')).toBe(600);
    expect(maxFor(req('GET', '/api/topics/categories'), '198.51.100.42')).toBe(600);
    expect(maxFor(req('HEAD', '/api/papers/openxiv:math-ph.2026.00001'), '198.51.100.42')).toBe(600);
  });

  it('keeps mutation and expensive generation routes on the configured ceiling', () => {
    expect(maxFor(req('POST', '/api/papers/paper-1/explain'), '198.51.100.42')).toBe(60);
    expect(maxFor(req('POST', '/api/papers/paper-1/endorsements'), '198.51.100.42')).toBe(60);
    expect(maxFor(req('POST', '/api/submissions'), '198.51.100.42')).toBe(60);
  });
});
