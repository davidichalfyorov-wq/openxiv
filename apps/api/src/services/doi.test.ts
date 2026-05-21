import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDoi, buildCrossrefDepositXml, loadDoiCredentials } from './doi.js';

const KEYS = ['CROSSREF_PREFIX', 'CROSSREF_USER', 'CROSSREF_PASSWORD'] as const;

describe('buildDoi (opaque suffix)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  it('returns null when CROSSREF_PREFIX absent', () => {
    expect(buildDoi('openxiv:cs.AI.2026.00001')).toBeNull();
  });

  it('returns null when prefix is malformed', () => {
    process.env['CROSSREF_PREFIX'] = 'not-a-prefix';
    expect(buildDoi('openxiv:cs.AI.2026.00001')).toBeNull();
  });

  it('emits opaque suffix derived from openxiv_id, not title', () => {
    process.env['CROSSREF_PREFIX'] = '10.99999';
    expect(buildDoi('openxiv:cs.AI.2026.00001')).toBe('10.99999/openxiv.cs.AI.2026.00001');
    // Same openxiv_id ⇒ same DOI (idempotency invariant).
    expect(buildDoi('openxiv:cs.AI.2026.00001')).toBe('10.99999/openxiv.cs.AI.2026.00001');
  });

  it('strips a leading "openxiv:" if present (single-form output)', () => {
    process.env['CROSSREF_PREFIX'] = '10.99999';
    expect(buildDoi('cs.AI.2026.00001')).toBe('10.99999/openxiv.cs.AI.2026.00001');
  });

  it('returns null on empty openxiv_id', () => {
    process.env['CROSSREF_PREFIX'] = '10.99999';
    expect(buildDoi('')).toBeNull();
    expect(buildDoi('openxiv:')).toBeNull();
  });
});

describe('loadDoiCredentials', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  it('returns null until all three vars are present', () => {
    expect(loadDoiCredentials()).toBeNull();
    process.env['CROSSREF_PREFIX'] = '10.99999';
    expect(loadDoiCredentials()).toBeNull();
    process.env['CROSSREF_USER'] = 'op';
    expect(loadDoiCredentials()).toBeNull();
    process.env['CROSSREF_PASSWORD'] = 'secret';
    expect(loadDoiCredentials()).toEqual({ prefix: '10.99999', user: 'op', password: 'secret' });
  });
});

describe('buildCrossrefDepositXml', () => {
  it('produces well-formed XML with the doi + canonical URL + posted_date', () => {
    const xml = buildCrossrefDepositXml({
      doi: '10.99999/openxiv.cs.AI.2026.00001',
      paperId: 'abcd-1234',
      title: 'Hello World',
      publishedAt: '2026-05-18T12:34:56.000Z',
      canonicalUrl: 'https://openxiv.net/abs/cs.AI.2026.00001',
    });
    expect(xml).toContain('<doi>10.99999/openxiv.cs.AI.2026.00001</doi>');
    expect(xml).toContain('<resource>https://openxiv.net/abs/cs.AI.2026.00001</resource>');
    expect(xml).toContain('<month>05</month>');
    expect(xml).toContain('<day>18</day>');
    expect(xml).toContain('<year>2026</year>');
    expect(xml).toMatch(/<title>Hello World<\/title>/);
  });

  it('escapes XML-special characters in the title', () => {
    const xml = buildCrossrefDepositXml({
      doi: '10.99999/openxiv.x',
      paperId: 'pid',
      title: 'A & B > C',
      publishedAt: '2026-01-01T00:00:00Z',
      canonicalUrl: 'https://x',
    });
    expect(xml).toContain('A &amp; B &gt; C');
  });
});
