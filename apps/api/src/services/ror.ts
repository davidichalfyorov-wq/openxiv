import type { AppResultAsync } from '@openxiv/shared';
import { fetchWithTimeoutRetry, wrapBreaker } from '@openxiv/clients';
import type { AppContext } from '../context.js';

/**
 * Research Organization Registry (ROR) client. Wraps the public
 * `api.ror.org` typeahead so the submit wizard can resolve a free-text
 * affiliation to a stable identifier (e.g. `https://ror.org/00f54p054`
 * for Stanford). Fallback is empty array — a slow/down ROR never blocks
 * the submission flow.
 *
 * Resilience knobs:
 *   - 5s timeout per request (configurable via env).
 *   - opossum circuit breaker, trips at 50% error rate over the rolling
 *     window, half-open after 30s.
 *   - 200ms client-side debounce expected at the caller (wizard) — we
 *     don't enforce on this side because the wizard already does it.
 *
 * Output is the projection the wizard needs, NOT the full ROR API blob:
 * we keep external coupling shallow.
 */

export interface RorMatch {
  readonly id: string; // canonical ror id, e.g. "https://ror.org/00f54p054"
  readonly name: string;
  readonly country?: string;
}

export interface RorClient {
  search(query: string): AppResultAsync<RorMatch[]>;
  /**
   * Validate a ror.org URL or a bare ROR id. Returns canonical
   * `https://ror.org/<id>` on success. Pure — no network call.
   */
  canonicalize(input: string): string | null;
}

const ROR_API = 'https://api.ror.org/organizations';
const TIMEOUT_MS = 5000;

export function makeRorClient(_ctx: AppContext): RorClient {
  const search = wrapBreaker(
    {
      name: 'ror.search',
      timeoutMs: TIMEOUT_MS,
      errorThresholdPercent: 50,
      resetTimeoutMs: 30_000,
    },
    async (query: string): Promise<RorMatch[]> => {
      if (query.trim().length < 3) return [];
      const url = `${ROR_API}?query=${encodeURIComponent(query.trim())}`;
      const res = await fetchWithTimeoutRetry(url, {
        timeoutMs: TIMEOUT_MS,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`ror ${res.status}`);
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          name: string;
          country?: { country_code?: string };
        }>;
      };
      const items = data.items ?? [];
      return items.slice(0, 10).map((i) => ({
        id: i.id,
        name: i.name,
        ...(i.country?.country_code ? { country: i.country.country_code } : {}),
      }));
    },
  );

  return {
    search(query) {
      return search(query);
    },
    canonicalize(input) {
      return canonicalizeRorId(input);
    },
  };
}

/**
 * Accept either:
 *   • `https://ror.org/<id>` (canonical)
 *   • `ror.org/<id>` (no scheme)
 *   • `<id>` (bare 9-char base32, e.g. "00f54p054")
 *
 * The ROR id is exactly 9 base32 characters (excluding 'l', 'i', 'o', 'u')
 * per the ROR spec. Returns the canonical URL form, or null if invalid.
 *
 * Exported for tests.
 */
export function canonicalizeRorId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  // base32 alphabet per the ROR spec.
  const bareRe = /^[0-9a-hjkmnp-tv-z]{9}$/;
  if (bareRe.test(raw)) return `https://ror.org/${raw}`;
  const urlRe = /^(https?:\/\/)?ror\.org\/([0-9a-hjkmnp-tv-z]{9})$/;
  const m = urlRe.exec(raw);
  if (m) return `https://ror.org/${m[2]!}`;
  return null;
}

export const __testing = { TIMEOUT_MS, canonicalizeRorId };
