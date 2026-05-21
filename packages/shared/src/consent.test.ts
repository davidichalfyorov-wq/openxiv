import { describe, expect, it } from 'vitest';
import {
  CONSENT_COOKIE_NAME,
  CONSENT_SCHEMA_VERSION,
  acceptAll,
  buildSetCookieHeader,
  customConsent,
  parseConsent,
  readConsentFromHeader,
  rejectAll,
  serializeConsent,
} from './consent.js';

describe('consent state', () => {
  it('acceptAll grants both opt-in flags', () => {
    const s = acceptAll(1_700_000_000_000);
    expect(s).toEqual({
      essential: true,
      analytics: true,
      marketing: true,
      ts: 1_700_000_000_000,
      version: 1,
    });
  });

  it('rejectAll keeps both flags off', () => {
    const s = rejectAll(1_700_000_000_000);
    expect(s.analytics).toBe(false);
    expect(s.marketing).toBe(false);
    expect(s.essential).toBe(true);
  });

  it('customConsent honours per-flag toggles', () => {
    const onlyAnalytics = customConsent({ analytics: true, marketing: false });
    expect(onlyAnalytics.analytics).toBe(true);
    expect(onlyAnalytics.marketing).toBe(false);
    const onlyMarketing = customConsent({ marketing: true });
    expect(onlyMarketing.marketing).toBe(true);
    expect(onlyMarketing.analytics).toBe(false);
  });

  it('serialize/parse round-trips exact state', () => {
    // Use a *fresh* timestamp; the parser rejects anything older than
    // 1y, so reusing a 2023 epoch number would fail in production runs.
    const original = customConsent({ analytics: true, marketing: false });
    const serialized = serializeConsent(original);
    const parsed = parseConsent(serialized);
    expect(parsed).toEqual(original);
  });

  it('parse returns null for missing / empty input', () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
    expect(parseConsent('')).toBeNull();
  });

  it('parse returns null on malformed base64 / json', () => {
    expect(parseConsent('not-base64')).toBeNull();
    expect(parseConsent('YQ==')).toBeNull(); // valid base64, invalid JSON
  });

  it('parse returns null on wrong schema version', () => {
    // simulate a v0 cookie: serialize v1, but the parser asserts v=1
    // so a manually crafted v=2 payload must be rejected.
    const json = JSON.stringify({ e: 1, a: 0, m: 0, t: Date.now(), v: 2 });
    const enc = Buffer.from(json, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(parseConsent(enc)).toBeNull();
  });

  it('parse returns null on stale timestamp (>1y)', () => {
    const stale = customConsent({ analytics: true }, Date.now() - (366 * 24 * 60 * 60 * 1000));
    const enc = serializeConsent(stale);
    expect(parseConsent(enc)).toBeNull();
  });

  it('parse returns null on future-dated timestamp', () => {
    const future = customConsent({ analytics: true }, Date.now() + 10_000);
    const enc = serializeConsent(future);
    expect(parseConsent(enc)).toBeNull();
  });

  it('readConsentFromHeader extracts the cookie from a full Cookie: header', () => {
    const enc = serializeConsent(acceptAll(Date.now()));
    const header = `foo=bar; ${CONSENT_COOKIE_NAME}=${enc}; other=baz`;
    const parsed = readConsentFromHeader(header);
    expect(parsed?.marketing).toBe(true);
    expect(parsed?.analytics).toBe(true);
  });

  it('readConsentFromHeader returns null when cookie absent', () => {
    expect(readConsentFromHeader('foo=bar; other=baz')).toBeNull();
    expect(readConsentFromHeader(null)).toBeNull();
    expect(readConsentFromHeader(undefined)).toBeNull();
  });

  it('buildSetCookieHeader emits 1y Max-Age + Secure + SameSite=Lax', () => {
    const header = buildSetCookieHeader(rejectAll());
    expect(header).toContain(`${CONSENT_COOKIE_NAME}=`);
    expect(header).toContain('Max-Age=31536000');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    // No HttpOnly — banner needs to read it.
    expect(header).not.toContain('HttpOnly');
  });

  it('CONSENT_SCHEMA_VERSION is pinned at 1', () => {
    expect(CONSENT_SCHEMA_VERSION).toBe(1);
  });
});
