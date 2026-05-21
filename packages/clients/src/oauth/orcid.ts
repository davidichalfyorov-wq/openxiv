import { Errors, fromPromise, randomToken } from '@openxiv/shared';
import { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeoutRetry } from '../http.js';
import type { AuthorizeUrl, AuthorizeUrlOptions, OAuthClient, OAuthProfile } from './interface.js';

export interface OrcidOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly useSandbox: boolean;
}

interface OrcidTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  orcid: string;
  name?: string;
  scope?: string;
}

export interface OrcidOAuthState {
  readonly nonce: string;
  readonly redirectAfter?: string;
  readonly intent?: 'signin' | 'link';
  readonly scope?: string;
}

export function encodeOrcidState(state: OrcidOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

export function decodeOrcidState(raw: string): OrcidOAuthState | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OrcidOAuthState;
    if (!parsed || typeof parsed.nonce !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function makeOrcidOAuthClient(cfg: OrcidOAuthConfig): OAuthClient {
  const authBase = cfg.useSandbox ? 'https://sandbox.orcid.org' : 'https://orcid.org';

  return {
    provider: 'orcid',
    authorizeUrl(redirectAfter?: string, options?: AuthorizeUrlOptions) {
      const scope = options?.scope ?? '/authenticate';
      const state = encodeOrcidState({
        nonce: randomToken(16),
        ...(redirectAfter ? { redirectAfter } : {}),
        ...(options?.intent ? { intent: options.intent } : {}),
        scope,
      });
      const url = new URL(`${authBase}/oauth/authorize`);
      url.searchParams.set('client_id', cfg.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', scope);
      url.searchParams.set('redirect_uri', cfg.redirectUri);
      url.searchParams.set('state', state);
      const result: AuthorizeUrl = { url: url.toString(), state };
      return fromPromise(Promise.resolve(result));
    },
    exchange({ code }) {
      const work = async (): Promise<OAuthProfile> => {
        const body = new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: cfg.redirectUri,
          code,
        });
        const res = await fetchWithTimeoutRetry(`${authBase}/oauth/token`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body,
          timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`orcid token exchange ${res.status}: ${detail.slice(0, 500)}`);
        }
        const json = (await res.json()) as OrcidTokenResponse;
        return {
          provider: 'orcid',
          subject: json.orcid,
          orcid: json.orcid,
          displayName: json.name ?? json.orcid,
          accessToken: json.access_token,
          ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
          ...(json.scope ? { scope: json.scope } : {}),
          ...(json.expires_in
            ? { expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString() }
            : {}),
        };
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('orcid.exchange', cause),
      );
    },
  };
}
