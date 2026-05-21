/**
 * IndexNow protocol client.
 *
 * IndexNow is a one-shot ping protocol supported by Bing and Yandex (and
 * shared across other participating engines): we POST a URL list, they
 * recrawl it within seconds rather than waiting for the next scheduled
 * pass. The endpoint is federated — one ping fans out to all engines.
 *
 * Ownership of the host is proven by serving a `/{KEY}.txt` file whose
 * contents equal the key. The web layer handles that via a dynamic Astro
 * route that gates on env equality, so the key never gets committed to
 * the file tree.
 *
 * This module is best-effort: every failure path returns
 * `{ attempted: false }` and never throws. Callers fire-and-forget.
 *
 * Spec: https://www.indexnow.org/documentation
 */

import type { AppContext } from '../context.js';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

/** Allowed character set per spec: letters/digits/dashes, 8-128 chars. */
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

/** Spec caps a single bulk submission at 10,000 URLs. */
const MAX_URLS_PER_PING = 10_000;

/** Hard request timeout — IndexNow is not on the publish hot path, but we
 * still don't want a hanging connection to leak into health checks. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface IndexNowResult {
  /** Whether the ping was attempted (false when key/urls invalid or empty). */
  attempted: boolean;
  /** HTTP status when attempted. */
  status?: number;
  /** True iff status is 200 (queued) or 202 (key validation pending). */
  ok?: boolean;
  /** Error message when the request itself failed (network/timeout). */
  error?: string;
}

/**
 * Submit URLs to IndexNow. Best-effort: any failure path logs once and
 * returns `{ attempted: false }`.
 *
 * Foreign-host URLs are dropped before submission — the spec returns 422
 * if `urlList` mixes hosts, so we filter preemptively. Duplicate URLs are
 * also de-duped because pinging the same URL twice is wasted credit
 * against the unspecified-but-real spam threshold.
 */
export async function submitToIndexNow(
  ctx: AppContext,
  urls: readonly string[],
): Promise<IndexNowResult> {
  const key = ctx.env.INDEXNOW_KEY?.trim();
  if (!key || !KEY_PATTERN.test(key)) {
    return { attempted: false };
  }
  if (urls.length === 0) {
    return { attempted: false };
  }

  let host: string;
  try {
    host = new URL(ctx.env.PUBLIC_WEB_BASE).host;
  } catch {
    return { attempted: false };
  }

  const filtered = Array.from(
    new Set(
      urls.filter((u) => {
        try {
          return new URL(u).host === host;
        } catch {
          return false;
        }
      }),
    ),
  ).slice(0, MAX_URLS_PER_PING);
  if (filtered.length === 0) return { attempted: false };

  const body = JSON.stringify({
    host,
    key,
    urlList: filtered,
  });

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const ok = res.status === 200 || res.status === 202;
    if (!ok) {
      console.warn(
        `[indexnow] non-success status ${res.status} for ${filtered.length} url(s)`,
      );
    }
    return { attempted: true, status: res.status, ok };
  } catch (err) {
    const message = (err as Error).message;
    console.warn('[indexnow] submission failed:', message);
    return { attempted: false, error: message };
  }
}

/**
 * Canonical paper URL — matches the /p/{slug} route the web layer serves
 * and emits as the rel=canonical link in PaperMeta.astro. Search engines
 * MUST receive the canonical URL or they'll see two URLs (e.g. /abs/...
 * and /p/...) as separate pages and split ranking weight.
 *
 * Slug derivation prefers the human-readable openxivId (e.g.
 * "openxiv:cs.AI.2026.00117" → "cs.AI.2026.00117"). Falls back to the
 * internal paper UUID when no openxivId has been assigned yet — that
 * branch should be unreachable from the publish path since id-assignment
 * runs before publish, but defending against it keeps the helper total.
 */
export function paperCanonicalUrl(
  publicWebBase: string,
  openxivId: string | null,
  paperId: string,
): string {
  const base = publicWebBase.replace(/\/+$/, '');
  if (openxivId) {
    const slug = openxivId.replace(/^openxiv:/, '');
    return `${base}/p/${encodeURIComponent(slug)}`;
  }
  return `${base}/paper/${encodeURIComponent(paperId)}`;
}
