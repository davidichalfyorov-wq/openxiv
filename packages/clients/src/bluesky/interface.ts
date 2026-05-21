import type { AppResultAsync } from '@openxiv/shared';
import type { OAuthProfile } from '../oauth/interface.js';

/**
 * Live, authenticated XRPC session against the user's PDS. Created by
 * `BlueskyAuthClient.restoreSession(did)` after the user has completed an
 * OAuth flow. The session is DPoP-bound: every outbound request signs a
 * fresh DPoP proof, so an intercepted bearer token alone is not enough to
 * impersonate. Tokens auto-refresh via the underlying NodeOAuthClient's
 * session store — callers do not see refresh logic.
 */
export interface BlueskyAgentSession {
  readonly did: string;
  /** Resolved PDS service URL the user lives on (after DID resolution). */
  readonly serviceUrl: string;
  /** Authenticated XRPC POST: send a JSON body, receive a JSON response. */
  post<T>(nsid: string, body: unknown): AppResultAsync<T>;
  /** Authenticated XRPC GET with querystring params. */
  get<T>(nsid: string, query?: Record<string, string>): AppResultAsync<T>;
  /** Upload a blob, returning the AT-proto blob ref to embed. */
  uploadBlob(
    data: Buffer,
    mimeType: string,
  ): AppResultAsync<BlobRef>;
}

export interface BlobRef {
  readonly $type: 'blob';
  readonly ref: { readonly $link: string };
  readonly mimeType: string;
  readonly size: number;
}

/**
 * Bluesky OAuth client. Separate from the legacy `OAuthClient` interface
 * because atproto OAuth is materially different from ORCID/Google: it takes
 * a *handle* (not just a callback URL), the callback payload is processed
 * by the lib (PAR exchange, DPoP binding, token endpoint negotiation), and
 * sessions are long-lived with auto-refresh.
 */
export interface BlueskyAuthClient {
  readonly provider: 'bluesky';
  /** Build authorize URL. `handle` may be a handle or a DID. */
  authorize(input: {
    handle: string;
    redirectAfter?: string;
    intent?: 'signin' | 'link';
  }): AppResultAsync<{ url: string }>;
  /** Process the callback URL's query string. */
  callback(params: URLSearchParams): AppResultAsync<{
    profile: OAuthProfile;
    did: string;
    redirectAfter?: string;
    intent?: 'signin' | 'link';
  }>;
  /** Restore a session for the given DID (refreshing tokens if needed). */
  restoreSession(did: string): AppResultAsync<BlueskyAgentSession>;
  /** Check whether a local OAuth session record exists without restoring it. */
  hasSession(did: string): AppResultAsync<boolean>;
  /** Revoke and delete the session record. */
  revoke(did: string): AppResultAsync<void>;
  /** Public client metadata document (served over HTTPS in prod). */
  clientMetadata(): Record<string, unknown>;
}
