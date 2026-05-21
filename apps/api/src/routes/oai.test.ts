import Fastify from 'fastify';
import { ResultAsync } from '@openxiv/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context.js';
import { isOaiDate, parseOaiDate } from './oai.js';
import { oaiPmhRoutes } from './oai.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));

describe('isOaiDate — OAI-PMH datestamp grammar §3.1.1', () => {
  it('accepts day granularity (YYYY-MM-DD)', () => {
    expect(isOaiDate('2026-01-01')).toBe(true);
    expect(isOaiDate('2026-12-31')).toBe(true);
    expect(isOaiDate('2026-05-17')).toBe(true);
  });

  it('accepts seconds granularity (YYYY-MM-DDThh:mm:ssZ)', () => {
    expect(isOaiDate('2026-01-01T00:00:00Z')).toBe(true);
    expect(isOaiDate('2026-12-31T23:59:59Z')).toBe(true);
  });

  it('rejects unzulu-suffixed or offset variants', () => {
    expect(isOaiDate('2026-01-01T00:00:00')).toBe(false);
    expect(isOaiDate('2026-01-01T00:00:00+02:00')).toBe(false);
    expect(isOaiDate('2026-01-01T00:00:00.123Z')).toBe(false); // millisecond granularity not allowed
  });

  it('rejects out-of-range months and days even with valid shape', () => {
    expect(isOaiDate('2026-13-01')).toBe(false);
    expect(isOaiDate('2026-02-30')).toBe(false);
    expect(isOaiDate('2026-00-15')).toBe(false);
  });

  it('rejects junk', () => {
    expect(isOaiDate('')).toBe(false);
    expect(isOaiDate('not-a-date')).toBe(false);
    expect(isOaiDate('2026/01/01')).toBe(false);
    expect(isOaiDate('20260101')).toBe(false);
  });
});

describe('parseOaiDate — half-open windows', () => {
  it('parses day granularity as UTC midnight for `from`', () => {
    const d = parseOaiDate('2026-05-17', 'from');
    expect(d.toISOString()).toBe('2026-05-17T00:00:00.000Z');
  });

  it('parses day granularity as 23:59:59.999 for `until`', () => {
    const d = parseOaiDate('2026-05-17', 'until');
    expect(d.toISOString()).toBe('2026-05-17T23:59:59.999Z');
  });

  it('makes from=X&until=X actually include records updated on day X', () => {
    // The OAI-PMH spec is somewhat ambiguous on whether `until` is inclusive,
    // but most harvester clients (BASE, CORE, OpenAIRE) expect it to be —
    // otherwise from=2026-05-17&until=2026-05-17 returns zero records, which
    // is never what a user wants.
    const from = parseOaiDate('2026-05-17', 'from');
    const until = parseOaiDate('2026-05-17', 'until');
    expect(from.getTime()).toBeLessThan(until.getTime());
    const midnight = new Date('2026-05-17T12:00:00Z');
    expect(midnight.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(midnight.getTime()).toBeLessThanOrEqual(until.getTime());
  });

  it('preserves seconds-granularity `from` verbatim at .000 ms', () => {
    const d = parseOaiDate('2026-05-17T13:00:00Z', 'from');
    expect(d.toISOString()).toBe('2026-05-17T13:00:00.000Z');
  });

  it('rounds seconds-granularity `until` up to .999 so the upper bound is inclusive', () => {
    // BASE Validator harvests by last-seen datestamp, then re-queries
    // with `from=X&until=X`. Our DB stores millisecond precision, so a
    // record updated at "14:57:54.466Z" must still satisfy `until=
    // 14:57:54Z`. Without rounding, the upper bound is exclusive of
    // any sub-second remainder and incremental harvest reports zero
    // records — the exact failure mode the validator surfaced.
    const d = parseOaiDate('2026-05-17T13:00:00Z', 'until');
    expect(d.toISOString()).toBe('2026-05-17T13:00:00.999Z');
  });
});

describe('oaiPmhRoutes — BASE validator schema locations', () => {
  it('emits the canonical https oai_dc schemaLocation pair for BASE OVAL', async () => {
    const loaded = {
      paper: {
        id: 'paper-1',
        openxivId: 'openxiv:math-ph.2026.00001',
        title: 'A test preprint',
        abstract: 'A short abstract.',
        primaryCategory: 'math-ph',
        license: 'CC-BY-4.0',
        doi: null,
        createdAt: new Date('2026-05-19T12:00:00Z'),
        publishedAt: new Date('2026-05-19T12:30:00Z'),
        updatedAt: new Date('2026-05-19T13:00:00Z'),
      },
      authors: [{ displayName: 'Ada Lovelace', orcid: null, affiliation: null }],
      categories: [],
      keywords: [],
    };
    const app = Fastify();
    app.decorate('ctx', {
      env: { PUBLIC_WEB_BASE: 'https://openxiv.net' },
      repos: {
        papers: {
          list: vi.fn(() => okAsync([{ id: 'paper-1' }])),
          loadWithRelations: vi.fn(() => okAsync(loaded)),
        },
      },
      redis: {},
    } as unknown as AppContext);
    await app.register(oaiPmhRoutes);

    const res = await app.inject({
      method: 'GET',
      url: '/oai-pmh?verb=ListRecords&metadataPrefix=oai_dc',
    });

    expect(res.statusCode, res.body).toBe(200);
    // Canonical pair: oai_dc namespace + the OAI canonical xsd over HTTPS.
    // arXiv uses the exact same pair. Verified against BASE OVAL on 2026-05-21.
    expect(res.body).toContain(
      'xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ https://www.openarchives.org/OAI/2.0/oai_dc.xsd"',
    );
    expect(res.body).not.toContain('/schemas/simpledc-20021212.xsd');
    expect(res.body).not.toContain('https://openxiv.net/schemas/oai_dc.xsd');

    const formats = await app.inject({
      method: 'GET',
      url: '/oai-pmh?verb=ListMetadataFormats',
    });
    expect(formats.statusCode, formats.body).toBe(200);
    expect(formats.body).toContain(
      '<schema>https://www.openarchives.org/OAI/2.0/oai_dc.xsd</schema>',
    );
    await app.close();
  });
});
