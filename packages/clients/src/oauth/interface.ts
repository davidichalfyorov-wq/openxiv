import type { AppResultAsync } from '@openxiv/shared';

export interface AuthorizeUrl {
  readonly url: string;
  readonly state: string;
  readonly codeVerifier?: string;
  readonly nonce?: string;
}

export type OAuthProvider = 'orcid' | 'google' | 'bluesky' | 'mastodon';

export interface OAuthProfile {
  readonly provider: OAuthProvider;
  readonly subject: string;
  readonly displayName: string;
  readonly email?: string;
  readonly avatarUrl?: string;
  readonly orcid?: string;
  readonly handle?: string;
  readonly did?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly scope?: string;
  readonly expiresAt?: string;
}

export interface AuthorizeUrlOptions {
  readonly redirectAfter?: string;
  readonly intent?: 'signin' | 'link';
  readonly scope?: string;
}

export interface OAuthClient {
  readonly provider: OAuthProfile['provider'];
  authorizeUrl(redirectAfter?: string, options?: AuthorizeUrlOptions): AppResultAsync<AuthorizeUrl>;
  exchange(params: {
    code: string;
    state: string;
    codeVerifier?: string;
    nonce?: string;
  }): AppResultAsync<OAuthProfile>;
}
