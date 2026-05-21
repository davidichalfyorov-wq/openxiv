import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import { fetchWithTimeoutRetry, wrapBreaker } from '@openxiv/clients';
import type { OpenAlexRelatedWork } from '@openxiv/db';
import type { AppContext } from '../context.js';

/**
 * OpenAlex enrichment client. Queries `api.openalex.org/works` to find
 * related works for a paper given title + DOI fallback. Cheap, public,
 * polite-pool friendly (mailto query param).
 *
 * Failure modes:
 *   - Timeout (5s) → return empty enrichment, never throw to the saga.
 *   - Circuit open → same.
 *   - Bad response shape → log + return empty.
 *
 * The worker that consumes this enqueues a job after the GROBID stage
 * succeeds; the call here is one HTTP fetch + a small projection.
 */

export interface OpenAlexEnrichment {
  openalexId: string | null;
  relatedWorks: OpenAlexRelatedWork[];
  topics: string[];
  institutions: string[];
}

export interface OpenAlexClient {
  enrich(input: {
    title: string;
    doi?: string;
    authors?: string[];
  }): AppResultAsync<OpenAlexEnrichment>;
}

const OPENALEX_API = 'https://api.openalex.org/works';
const TIMEOUT_MS = 5000;
const MAILTO_FALLBACK = 'davidich.alfyorov@gmail.com';

export function makeOpenAlexClient(ctx: AppContext): OpenAlexClient {
  const mailto = (process.env['OPENALEX_MAILTO'] ?? MAILTO_FALLBACK) || MAILTO_FALLBACK;
  void ctx;
  const wrappedEnrich = wrapBreaker(
    {
      name: 'openalex.enrich',
      timeoutMs: TIMEOUT_MS,
      errorThresholdPercent: 50,
      resetTimeoutMs: 60_000,
    },
    async (input: { title: string; doi?: string; authors?: string[] }): Promise<OpenAlexEnrichment> => {
      // Prefer the DOI lookup — exact match. Fall back to title search.
      const url = input.doi
        ? `${OPENALEX_API}/doi:${encodeURIComponent(input.doi)}?mailto=${encodeURIComponent(mailto)}`
        : `${OPENALEX_API}?search=${encodeURIComponent(input.title)}&per-page=1&mailto=${encodeURIComponent(mailto)}`;
      const res = await fetchWithTimeoutRetry(url, {
        timeoutMs: TIMEOUT_MS,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`openalex ${res.status}`);
      const body = await res.json();
      // Two response shapes: single object on /doi:, or {results: [...]} on /works?search=.
      const work = isWorkLike(body)
        ? body
        : ((body as { results?: unknown[] }).results?.[0] ?? null);
      if (!work || !isWorkLike(work)) return emptyEnrichment();
      const related: OpenAlexRelatedWork[] = (work.related_works ?? [])
        .slice(0, 10)
        .map((id) => ({ id: String(id), title: '' }));
      return {
        openalexId: work.id ?? null,
        relatedWorks: related,
        topics: (work.topics ?? [])
          .map((t) => t.display_name)
          .filter((s): s is string => typeof s === 'string' && s.length > 0),
        institutions: (work.institutions ?? [])
          .map((i) => i.display_name)
          .filter((s): s is string => typeof s === 'string' && s.length > 0),
      };
    },
  );

  return {
    enrich(input) {
      return wrappedEnrich(input).orElse(() =>
        // Breaker open or timeout — return empty so the saga continues
        // and we don't block the paper from publishing.
        fromPromise(Promise.resolve(emptyEnrichment()), () =>
          Errors.internal('openalex.enrich fallback'),
        ),
      );
    },
  };
}

function emptyEnrichment(): OpenAlexEnrichment {
  return { openalexId: null, relatedWorks: [], topics: [], institutions: [] };
}

interface OpenAlexWork {
  id?: string;
  related_works?: string[];
  topics?: Array<{ display_name?: string }>;
  institutions?: Array<{ display_name?: string }>;
}

function isWorkLike(x: unknown): x is OpenAlexWork {
  return typeof x === 'object' && x !== null && ('id' in x || 'related_works' in x);
}

export const __testing = { TIMEOUT_MS };
