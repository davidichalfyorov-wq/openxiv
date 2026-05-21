import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeoutRetry } from '@openxiv/clients';
import type { PaperRecord } from '@openxiv/db';

export interface MastodonAccount {
  readonly instanceUrl: string;
  readonly accessToken: string;
}

export interface MastodonStatusResult {
  readonly id: string;
  readonly url: string | null;
}

export function postStatus(
  account: MastodonAccount,
  paper: PaperRecord,
  publicBase: string,
): AppResultAsync<MastodonStatusResult> {
  return fromPromise(
    (async () => {
      const instanceUrl = normalizeInstanceUrl(account.instanceUrl);
      const res = await fetchWithTimeoutRetry(`${instanceUrl}/api/v1/statuses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${account.accessToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: buildMastodonStatus(paper, publicBase),
          visibility: 'public',
        }),
        timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Mastodon status ${res.status}: ${detail.slice(0, 500)}`);
      }
      const json = (await res.json()) as { id?: string; url?: string | null; uri?: string | null };
      if (!json.id) throw new Error('Mastodon response missing id');
      return { id: json.id, url: json.url ?? json.uri ?? null };
    })(),
    (cause) => Errors.externalInvalidResponse('mastodon.status.post', cause),
  );
}

export function buildMastodonStatus(paper: PaperRecord, publicBase: string): string {
  const id = paper.openxivId?.replace(/^openxiv:/, '') ?? paper.id;
  const url = `${publicBase.replace(/\/$/, '')}/p/${encodeURIComponent(id)}`;
  const categoryTag = hashtag(paper.primaryCategory);
  const suffix = `\n\n${url}\n\n#preprint ${categoryTag}`;
  const budget = 500 - suffix.length;
  const title = paper.title.length <= budget ? paper.title : `${paper.title.slice(0, Math.max(0, budget - 1))}...`;
  return `${title}${suffix}`;
}

export function normalizeInstanceUrl(input: string): string {
  const raw = input.trim();
  const account = raw.match(/^(?:acct:)?@?[^@\s/]+@([^@\s/]+)$/i);
  const source = account ? account[1]! : raw;
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : `https://${source}`);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('Mastodon instance URL must use http or https');
  }
  url.username = '';
  url.password = '';
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function hashtag(category: string): string {
  const body = category
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part, idx) => (idx === 0 ? part.toLowerCase() : part[0]!.toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
  return body ? `#${body}` : '#science';
}
