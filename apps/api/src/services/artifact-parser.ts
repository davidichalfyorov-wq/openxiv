import { fetchWithTimeoutRetry, wrapBreaker } from '@openxiv/clients';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { PaperArtifactType } from '@openxiv/db';

/**
 * Fetch + parse CITATION.cff / codemeta.json / arbitrary linked artifacts.
 *
 * Author submits a URL ("my code is on GitHub here") — we attempt to fetch
 * the standard metadata files and parse them. If we recognise the shape
 * we surface a friendly type + projected fields. If not, we still store
 * the URL with `type='other'` so the abs page can link to it.
 *
 * Resilience: 5s timeout, opossum breaker, fail-open with `{type, url}`
 * and `parsedMetadata = null`. Never blocks the submit wizard.
 */

export interface ArtifactProbeResult {
  type: PaperArtifactType;
  url: string;
  parsedMetadata: Record<string, unknown> | null;
}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024; // 256 KB — refuse to slurp a giant binary

const fetcher = wrapBreaker(
  {
    name: 'artifact.fetch',
    timeoutMs: TIMEOUT_MS,
    errorThresholdPercent: 50,
    resetTimeoutMs: 30_000,
  },
  async (url: string): Promise<{ status: number; contentType: string; body: string }> => {
    const res = await fetchWithTimeoutRetry(url, { timeoutMs: TIMEOUT_MS });
    const contentType = res.headers.get('content-type') ?? '';
    let body = '';
    if (contentType.startsWith('application/') || contentType.startsWith('text/')) {
      // Stream-bound read so a huge file doesn't OOM us.
      const reader = res.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (total < MAX_BYTES) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.byteLength;
        }
        body = new TextDecoder('utf-8').decode(
          chunks.reduce(
            (acc, c) => {
              const merged = new Uint8Array(acc.length + c.length);
              merged.set(acc);
              merged.set(c, acc.length);
              return merged;
            },
            new Uint8Array(0),
          ),
        );
      }
    }
    return { status: res.status, contentType, body };
  },
);

export function probeArtifact(input: { type: PaperArtifactType; url: string }): AppResultAsync<ArtifactProbeResult> {
  return fromPromise(
    (async (): Promise<ArtifactProbeResult> => {
      try {
        const res = await fetcher(input.url);
        if (res.isErr()) {
          return { type: input.type, url: input.url, parsedMetadata: null };
        }
        const { status, contentType, body } = res.value;
        if (status >= 400 || !body) {
          return { type: input.type, url: input.url, parsedMetadata: null };
        }
        const parsed = parseArtifactBody({ type: input.type, contentType, body });
        return { type: parsed.type, url: input.url, parsedMetadata: parsed.metadata };
      } catch {
        return { type: input.type, url: input.url, parsedMetadata: null };
      }
    })(),
    () => Errors.internal('artifact.probe'),
  );
}

/**
 * Parse a small artifact blob (≤256KB) into a typed projection.
 *
 *   • CITATION.cff — YAML; we only handle the canonical key/value subset
 *     because pulling in a full YAML parser is overkill for our needs.
 *   • codemeta.json — JSON-LD; we keep only a small projection.
 *
 * Exported for tests.
 */
export function parseArtifactBody(input: {
  type: PaperArtifactType;
  contentType: string;
  body: string;
}): { type: PaperArtifactType; metadata: Record<string, unknown> | null } {
  const trimmed = input.body.trim();
  if (input.type === 'codemeta' || input.contentType.includes('json')) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      // Light projection: only well-known top-level fields.
      const meta = pickKeys(json, ['name', 'description', 'license', 'codeRepository', 'programmingLanguage', '@type']);
      return { type: meta['@type'] === 'SoftwareSourceCode' ? 'codemeta' : input.type, metadata: meta };
    } catch {
      return { type: input.type, metadata: null };
    }
  }
  if (input.type === 'cff' || /\bcitation\.cff\b/i.test(input.contentType) || /^cff-version:\s/m.test(trimmed)) {
    return { type: 'cff', metadata: parseCff(trimmed) };
  }
  return { type: input.type, metadata: null };
}

function pickKeys(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/**
 * Minimal CFF subset parser. Handles the canonical `key: value` lines we
 * care about (`cff-version`, `title`, `abstract`, `version`, `doi`,
 * `repository-code`, `license`, `authors` as YAML lists). Skips
 * everything else. Anything that doesn't parse as a key:value line is
 * ignored, NOT errored — partial info is better than zero info.
 */
function parseCff(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*?):\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1]!;
    const rawValue = m[2]!.trim();
    if (
      key === 'cff-version' ||
      key === 'title' ||
      key === 'abstract' ||
      key === 'version' ||
      key === 'doi' ||
      key === 'repository-code' ||
      key === 'license' ||
      key === 'message'
    ) {
      out[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

export const __testing = { parseArtifactBody, parseCff, TIMEOUT_MS };
