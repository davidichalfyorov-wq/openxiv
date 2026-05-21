import { Errors, type AppResultAsync, fromPromise, randomToken } from '@openxiv/shared';
import { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeoutRetry } from '../http.js';
import type { OAuthClient, OAuthProfile } from './interface.js';

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
}

interface GoogleUserInfo {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

export function makeGoogleOAuthClient(cfg: GoogleOAuthConfig): OAuthClient {
  return {
    provider: 'google',
    authorizeUrl() {
      const state = randomToken(16);
      const nonce = randomToken(16);
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', cfg.clientId);
      url.searchParams.set('redirect_uri', cfg.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('access_type', 'offline');
      return fromPromise(Promise.resolve({ url: url.toString(), state, nonce }));
    },
    exchange({ code }): AppResultAsync<OAuthProfile> {
      const work = async (): Promise<OAuthProfile> => {
        const tokenRes = await fetchWithTimeoutRetry('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: cfg.redirectUri,
          }),
          timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
        });
        if (!tokenRes.ok) {
          throw new Error(`google token ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 300)}`);
        }
        const tokens = (await tokenRes.json()) as GoogleTokenResponse;

        const infoRes = await fetchWithTimeoutRetry('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
        });
        if (!infoRes.ok) {
          throw new Error(`google userinfo ${infoRes.status}`);
        }
        const info = (await infoRes.json()) as GoogleUserInfo;
        const profile: OAuthProfile = {
          provider: 'google',
          subject: info.sub,
          displayName: info.name ?? info.email ?? info.sub,
          ...(info.email ? { email: info.email } : {}),
          ...(info.picture ? { avatarUrl: info.picture } : {}),
        };
        return profile;
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('google.exchange', cause),
      );
    },
  };
}
