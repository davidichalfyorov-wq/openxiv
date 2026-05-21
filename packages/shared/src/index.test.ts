import { describe, expect, it } from 'vitest';
import {
  AppError,
  Errors,
  combine,
  err,
  fromPromise,
  fromThrowable,
  generateTid,
  groupCategories,
  isCategoryCode,
  makeAtUri,
  ok,
  parseAtUri,
  parseEnv,
  sha256Hex,
} from './index.js';

describe('AppError', () => {
  it('serialises with the kind', () => {
    const e = Errors.validation('bad', { field: 'x' });
    const json = e.toJSON();
    expect(json.kind).toBe('validation');
    expect(json.message).toBe('bad');
    expect(json.detail).toEqual({ field: 'x' });
  });

  it('maps to status codes', () => {
    expect(Errors.validation('bad').toStatusCode()).toBe(400);
    expect(Errors.notFound('nope').toStatusCode()).toBe(404);
    expect(Errors.externalUnavailable('grobid down').toStatusCode()).toBe(502);
    expect(Errors.internal('boom').toStatusCode()).toBe(500);
  });
});

describe('Result helpers', () => {
  it('fromPromise wraps rejection as AppError', async () => {
    const result = await fromPromise(Promise.reject(new Error('boom')));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AppError);
      expect(result.error.kind).toBe('internal');
    }
  });

  it('fromThrowable maps throws', () => {
    const result = fromThrowable(() => {
      throw new Error('x');
    });
    expect(result.isErr()).toBe(true);
  });

  it('combine short-circuits on first error', () => {
    const r = combine([ok(1), err(Errors.validation('bad')), ok(2)]);
    expect(r.isErr()).toBe(true);
  });
});

describe('ids', () => {
  it('TIDs are 13 chars and monotonic', () => {
    const a = generateTid();
    const b = generateTid();
    expect(a).toMatch(/^[a-z2-7]{13}$/);
    expect(b).toMatch(/^[a-z2-7]{13}$/);
    expect(a < b).toBe(true);
  });

  it('round-trips an at-uri', () => {
    const did = 'did:plc:abcdefghijklmnopqrstuvwx';
    const uri = makeAtUri(did, 'app.openxiv.paper', '3kabcdef12345');
    const parsed = parseAtUri(uri);
    expect(parsed).toEqual({ did, collection: 'app.openxiv.paper', rkey: '3kabcdef12345' });
  });

  it('rejects malformed at-uri', () => {
    expect(parseAtUri('not-an-at-uri')).toBeNull();
  });

  it('sha256Hex hashes deterministically', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

describe('categories', () => {
  it('groups by discipline', () => {
    const grouped = groupCategories();
    expect(grouped.Physics.length).toBeGreaterThan(10);
    expect(grouped['Computer Science']).toContainEqual(expect.objectContaining({ code: 'cs.AI' }));
  });

  it('isCategoryCode validates', () => {
    expect(isCategoryCode('cs.AI')).toBe(true);
    expect(isCategoryCode('xx.YY')).toBe(false);
  });
});

describe('env', () => {
  it('parses minimal env with defaults', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://x',
      S3_ENDPOINT: 'http://x',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
      S3_BUCKET: 'c',
      SESSION_SECRET: 'x'.repeat(32),
      JWT_SECRET: 'y'.repeat(32),
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4321']);
    expect(env.RATE_LIMIT_MAX).toBe(60);
    expect(env.SENTRY_DSN).toBe('');
  });

  it('parses optional Sentry settings without requiring them locally', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://x',
      S3_ENDPOINT: 'http://x',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
      S3_BUCKET: 'c',
      SESSION_SECRET: 'x'.repeat(32),
      JWT_SECRET: 'y'.repeat(32),
      SENTRY_DSN: 'https://public@example.invalid/1',
      SENTRY_RELEASE: 'openxiv-test',
    });
    expect(env.SENTRY_DSN).toBe('https://public@example.invalid/1');
    expect(env.SENTRY_RELEASE).toBe('openxiv-test');
  });

  it('throws on missing required', () => {
    expect(() => parseEnv({} as Record<string, string>)).toThrow();
  });

  it('rejects production mock clients and placeholder endpoints', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        REDIS_URL: 'redis://x',
        S3_ENDPOINT: 'https://s3.openxiv.test',
        S3_ACCESS_KEY_ID: 'minioadmin',
        S3_SECRET_ACCESS_KEY: 'minioadmin',
        S3_BUCKET: 'openxiv-blobs',
        SESSION_SECRET: 'abcdefghijklmnopqrstuvwxyzABCDEF',
        JWT_SECRET: 'FEDCBAzyxwvutsrqponmlkjihgfedcba',
        PUBLIC_API_BASE: 'https://openxiv.net',
        PUBLIC_WEB_BASE: 'https://openxiv.net',
        CORS_ORIGINS: 'https://openxiv.net,*',
        USE_MOCK_LATEXML: 'true',
        ORCID_CLIENT_ID: '',
        ORCID_CLIENT_SECRET: '',
        BLUESKY_OAUTH_CLIENT_ID: 'http://localhost',
      }),
    ).toThrow(/mock clients are forbidden in production/);
  });
});
