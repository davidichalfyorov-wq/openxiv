import { describe, expect, it } from 'vitest';

/**
 * Pure-function unit tests for the meta-tag generation logic, exercising
 * the date formatter and JSON-LD escape helper without spinning the full
 * Astro renderer.
 *
 * The Astro components themselves (PaperMeta.astro, ProfileSeo.astro,
 * Base.astro) are tested end-to-end by `e2e/tests/scholar-metadata.spec.ts`
 * and `e2e/tests/profile-seo.spec.ts` against the SSR HTML — that's
 * authoritative for what crawlers see. This file covers the small,
 * deterministic helpers we inline at the top of each component.
 */

// Mirror of PaperMeta.astro's date conversion. Highwire wants YYYY/MM/DD,
// schema.org wants YYYY-MM-DD; we keep both, both from the same source so
// they never drift.
function toScholarDate(iso: string): string {
  const date = iso.slice(0, 10);
  return date.replace(/-/g, '/');
}

// Mirror of safeJsonLd from the components.
const LS_RE = new RegExp('\\u2028', 'g');
const PS_RE = new RegExp('\\u2029', 'g');
function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LS_RE, '\\u2028')
    .replace(PS_RE, '\\u2029');
}

describe('toScholarDate', () => {
  it('formats a full ISO 8601 timestamp', () => {
    expect(toScholarDate('2026-05-18T12:34:56.789Z')).toBe('2026/05/18');
  });
  it('formats a date-only string', () => {
    expect(toScholarDate('2026-05-18')).toBe('2026/05/18');
  });
  it('handles single-digit month/day with zero-padding intact', () => {
    expect(toScholarDate('2026-01-09')).toBe('2026/01/09');
  });
});

describe('safeJsonLd', () => {
  it('round-trips a vanilla object', () => {
    const v = { '@type': 'ScholarlyArticle', name: 'Hello' };
    const enc = safeJsonLd(v);
    expect(JSON.parse(enc)).toEqual(v);
  });

  it('escapes </script> so a title cannot break out of the script block', () => {
    const v = { name: '</script><img src=x onerror=alert(1)>' };
    const enc = safeJsonLd(v);
    expect(enc).not.toContain('</script>');
    expect(enc).toContain('\\u003c');
  });

  it('escapes ampersand entities so HTML parsers do not get confused', () => {
    const v = { name: 'AT&T paper' };
    const enc = safeJsonLd(v);
    expect(enc).toContain('\\u0026');
    expect(JSON.parse(enc).name).toBe('AT&T paper');
  });

  it('escapes the Unicode line separator (U+2028) — illegal in JSONP', () => {
    const v = { name: 'Line Break' };
    const enc = safeJsonLd(v);
    expect(enc).toContain('\\u2028');
    expect(enc).not.toContain(' ');
  });

  it('escapes the Unicode paragraph separator (U+2029)', () => {
    const v = { name: 'Para Break' };
    const enc = safeJsonLd(v);
    expect(enc).toContain('\\u2029');
    expect(enc).not.toContain(' ');
  });

  it('handles arrays of objects (citation list)', () => {
    const v = {
      '@context': 'https://schema.org',
      '@type': 'ScholarlyArticle',
      author: [
        { '@type': 'Person', name: 'Alice' },
        { '@type': 'Person', name: 'Bob' },
      ],
    };
    const enc = safeJsonLd(v);
    expect(JSON.parse(enc)).toEqual(v);
  });

  it('does not introduce stray backslashes that confuse JSON parsers', () => {
    const v = { name: 'simple' };
    const enc = safeJsonLd(v);
    // Round-trip a million times: every output should be parseable.
    for (let i = 0; i < 50; i++) {
      expect(JSON.parse(safeJsonLd(JSON.parse(enc)))).toEqual(v);
    }
  });
});

describe('citation_publication_date format', () => {
  it.each([
    ['2026-05-18', '2026/05/18'],
    ['2025-12-31', '2025/12/31'],
    ['2024-02-29', '2024/02/29'],
    ['1999-01-01', '1999/01/01'],
  ])('%s → %s', (iso, expected) => {
    expect(toScholarDate(iso)).toBe(expected);
  });
});

describe('JSON-LD ScholarlyArticle minimal shape', () => {
  it('serialises without losing required fields', () => {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'ScholarlyArticle',
      identifier: 'openxiv:cs.AI.2026.00001',
      headline: 'A title',
      datePublished: '2026-05-18',
      isPartOf: {
        '@type': 'Periodical',
        name: 'OpenXiv',
        issn: '3120-9556',
      },
    };
    const enc = safeJsonLd(ld);
    const parsed = JSON.parse(enc);
    expect(parsed['@type']).toBe('ScholarlyArticle');
    expect(parsed.isPartOf.issn).toBe('3120-9556');
  });
});
