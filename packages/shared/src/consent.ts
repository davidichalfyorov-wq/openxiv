/**
 * Cookie-driven consent state used by the cookie banner and the Twitter
 * Pixel gate. Lives in `@openxiv/shared` so both the Astro server-render
 * pages and the client `is:inline` scripts can parse the same shape.
 *
 * Design constraints:
 *   - `essential` is always `true` (auth / session). The banner can't
 *     refuse it — that's what makes the site usable at all.
 *   - `analytics` and `marketing` default `false` until the user
 *     explicitly opts in. GDPR-friendly fail-closed posture.
 *   - `version` lets us invalidate a stored cookie when the consent
 *     surface changes (e.g. we add a new category) — increment, ship,
 *     and the old cookie reads as "unknown → show banner again".
 *   - `ts` is the epoch-ms when consent was last recorded. The banner
 *     uses this to age out very old cookies (1 year limit).
 *
 * The cookie name `openxiv_consent` is reserved; do not collide.
 */

export interface ConsentState {
  /** Always true. Session cookie + handle bootstrap. Cannot be refused. */
  readonly essential: true;
  /** First-party event ingest. Default false. */
  readonly analytics: boolean;
  /** Twitter Pixel + future third-party marketing trackers. Default false. */
  readonly marketing: boolean;
  /** Epoch ms when this state was written. */
  readonly ts: number;
  /** Schema version. Bump on breaking surface change. */
  readonly version: 1;
}

export const CONSENT_COOKIE_NAME = 'openxiv_consent';
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const CONSENT_SCHEMA_VERSION = 1 as const;

/**
 * The default state when no cookie is present. Both opt-in flags are
 * `false`; the caller decides whether to *show* the banner based on the
 * presence of the cookie itself, not on this value.
 */
export const DEFAULT_CONSENT: ConsentState = Object.freeze({
  essential: true,
  analytics: false,
  marketing: false,
  ts: 0,
  version: 1,
});

/**
 * The "reject all non-essential" preset. Written when the user clicks
 * Reject in the banner OR when DNT=1 is detected at first paint.
 */
export function rejectAll(now: number = Date.now()): ConsentState {
  return { essential: true, analytics: false, marketing: false, ts: now, version: 1 };
}

/**
 * The "accept all" preset. Written when the user clicks Accept all.
 */
export function acceptAll(now: number = Date.now()): ConsentState {
  return { essential: true, analytics: true, marketing: true, ts: now, version: 1 };
}

/**
 * Custom selection — preserves the caller's analytics/marketing picks.
 * `essential` is unconditionally `true`.
 */
export function customConsent(
  flags: { analytics?: boolean; marketing?: boolean },
  now: number = Date.now(),
): ConsentState {
  return {
    essential: true,
    analytics: !!flags.analytics,
    marketing: !!flags.marketing,
    ts: now,
    version: 1,
  };
}

/**
 * Serialize for the cookie. We use base64-encoded JSON so cookie-level
 * tooling (e.g. browser inspector copy) doesn't garble the payload, and
 * so a hand-edited cookie value is easy to spot as malformed.
 *
 * Output bytes are URL-safe base64 (no `+/=` padding) of the JSON form.
 */
export function serializeConsent(state: ConsentState): string {
  // ts is epoch-ms (Date.now()) which exceeds 32-bit signed int. The
  // earlier `| 0` truncated to int32 and corrupted the timestamp; use
  // Math.floor to keep the precision intact.
  const json = JSON.stringify({
    e: state.essential ? 1 : 0,
    a: state.analytics ? 1 : 0,
    m: state.marketing ? 1 : 0,
    t: Math.floor(state.ts),
    v: state.version,
  });
  return base64UrlEncode(json);
}

/**
 * Parse a cookie value. Returns `null` (not the default) when the cookie
 * is missing, malformed, an older schema version, or older than the max
 * age. The caller distinguishes "no cookie → show banner" from
 * "cookie says reject → no banner" by checking the returned value.
 */
export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null;
  try {
    const json = base64UrlDecode(raw);
    const parsed = JSON.parse(json) as {
      e?: number;
      a?: number;
      m?: number;
      t?: number;
      v?: number;
    };
    if (parsed.v !== CONSENT_SCHEMA_VERSION) return null;
    const ts = typeof parsed.t === 'number' ? parsed.t : 0;
    const ageMs = Date.now() - ts;
    if (ageMs < 0 || ageMs > CONSENT_COOKIE_MAX_AGE_SECONDS * 1000) return null;
    return {
      essential: true,
      analytics: parsed.a === 1,
      marketing: parsed.m === 1,
      ts,
      version: 1,
    };
  } catch {
    return null;
  }
}

/**
 * Build the Set-Cookie header value the banner writes. We pin
 * SameSite=Lax + Secure + Max-Age=1y per spec. HttpOnly is INTENTIONALLY
 * omitted — the client-side gate needs to read the cookie.
 */
export function buildSetCookieHeader(state: ConsentState): string {
  const enc = serializeConsent(state);
  return [
    `${CONSENT_COOKIE_NAME}=${enc}`,
    'Path=/',
    `Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
    'Secure',
  ].join('; ');
}

/**
 * Extract the consent cookie from a raw `Cookie:` header. Used by Astro
 * SSR pages to gate which scripts they render.
 */
export function readConsentFromHeader(cookieHeader: string | null | undefined): ConsentState | null {
  if (!cookieHeader) return null;
  const m = new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE_NAME}=([^;]+)`).exec(cookieHeader);
  return m ? parseConsent(m[1]) : null;
}

// ---------------------------------------------------------------------------
// base64url helpers (no dep)
// ---------------------------------------------------------------------------

function base64UrlEncode(s: string): string {
  // Node + browser both have btoa, but only on ASCII. Step through utf-8.
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (s.length % 4)) % 4);
  const bin = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
