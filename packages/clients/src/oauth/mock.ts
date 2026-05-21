import { ResultAsync, randomToken } from '@openxiv/shared';
import type { OAuthClient, OAuthProfile } from './interface.js';

/**
 * Mock OAuth client kept only for unit tests that import it directly. It is
 * never wired into production (factory.ts only selects it when explicit
 * USE_MOCK_* flags are set, which they are not on the live deployment).
 *
 * Profiles returned here are randomised so the mock cannot create a
 * recognisable persistent identity if it is ever accidentally enabled.
 */
export function makeMockOAuthClient(provider: OAuthProfile['provider']): OAuthClient {
  return {
    provider,
    authorizeUrl(redirectAfter?: string) {
      const state = randomToken(16);
      const nonce = randomToken(12);
      const presetProfile: OAuthProfile = {
        provider,
        subject: `mock-${provider}-${nonce}`,
        displayName: `Mock ${provider} user ${nonce.slice(0, 6)}`,
      };
      const code = Buffer.from(JSON.stringify(presetProfile)).toString('base64url');
      const url = `/auth/dev/mock-callback?provider=${provider}&code=${code}&state=${state}${
        redirectAfter ? `&redirect_after=${encodeURIComponent(redirectAfter)}` : ''
      }`;
      return ResultAsync.fromSafePromise(Promise.resolve({ url, state }));
    },
    exchange({ code }) {
      try {
        const parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as OAuthProfile;
        return ResultAsync.fromSafePromise(Promise.resolve(parsed));
      } catch {
        const fallback: OAuthProfile = {
          provider,
          subject: `mock-${provider}-${code.slice(0, 8)}`,
          displayName: `Mock ${provider} user`,
        };
        return ResultAsync.fromSafePromise(Promise.resolve(fallback));
      }
    },
  };
}
