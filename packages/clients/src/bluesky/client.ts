import type { Redis } from 'ioredis';
import { Errors, type AppResultAsync, ResultAsync, fromPromise } from '@openxiv/shared';
import { Agent, AtUri } from '@atproto/api';
import { JoseKey } from '@atproto/jwk-jose';
import {
  NodeOAuthClient,
  type NodeSavedSession,
  type OAuthClientMetadataInput,
} from '@atproto/oauth-client-node';
import type { OAuthProfile } from '../oauth/interface.js';
import { wrapBreaker } from '../circuit.js';
import { makeRedisSessionStore, makeRedisStateStore } from './stores.js';
import type {
  BlobRef,
  BlueskyAgentSession,
  BlueskyAuthClient,
} from './interface.js';

export interface BlueskyClientConfig {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly publicBase: string;
  readonly redis: Redis;
  /** Allow HTTP for the local dev loopback exception. */
  readonly allowHttp?: boolean;
}

/**
 * Decide which `client_id` shape to advertise. AT-proto OAuth permits a
 * special-cased "http://localhost" loopback identifier (with the redirect
 * URI carried in the URL fragment) so a developer can iterate without
 * hosting a public client metadata JSON over HTTPS. In every other case we
 * resolve to a real `https://…/oauth/client-metadata.json` URL — the server
 * MUST host that document; the lib fetches and validates it.
 */
function resolveClientMetadata(cfg: BlueskyClientConfig): {
  clientId: string;
  metadata: OAuthClientMetadataInput;
} {
  const scope = 'atproto transition:generic';
  // Loopback exception: the lib understands this special-cased client_id and
  // synthesises the client metadata in-memory; no JSON document required.
  const isLoopback =
    cfg.clientId.startsWith('http://localhost') ||
    cfg.clientId.startsWith('http://127.0.0.1');
  if (isLoopback) {
    // For loopback, the redirect_uri is appended to the URL as a query param.
    const params = new URLSearchParams();
    params.set('redirect_uri', cfg.redirectUri);
    params.set('scope', scope);
    return {
      clientId: `http://localhost?${params.toString()}`,
      metadata: {
        client_id: `http://localhost?${params.toString()}`,
        client_name: 'OpenXiv (local dev)',
        redirect_uris: [cfg.redirectUri as `http://127.0.0.1${string}`],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        scope,
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true,
      },
    };
  }
  // Production: client_id must be the public URL of a published metadata JSON
  // document at /oauth/client-metadata.json.
  return {
    clientId: cfg.clientId,
    metadata: {
      client_id: cfg.clientId as `https://${string}`,
      client_name: 'OpenXiv',
      client_uri: cfg.publicBase as `https://${string}`,
      logo_uri: `${cfg.publicBase}/brand/logo-mark.svg` as `https://${string}`,
      tos_uri: `${cfg.publicBase}/terms` as `https://${string}`,
      policy_uri: `${cfg.publicBase}/privacy` as `https://${string}`,
      redirect_uris: [cfg.redirectUri as `https://${string}`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      scope,
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    },
  };
}

interface DeferredClient {
  client: NodeOAuthClient;
  metadata: OAuthClientMetadataInput;
}

type BlueskyAuthIntent = 'signin' | 'link';

interface CallbackState {
  readonly redirectAfter?: string;
  readonly intent?: BlueskyAuthIntent;
}

function encodeCallbackState(input: CallbackState): string {
  const payload: Record<string, string> = {};
  if (input.redirectAfter) payload['r'] = input.redirectAfter;
  if (input.intent) payload['i'] = input.intent;
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function parseCallbackState(state: string | undefined): CallbackState {
  if (!state) return {};
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
      r?: unknown;
      i?: unknown;
    };
    const out: { redirectAfter?: string; intent?: BlueskyAuthIntent } = {};
    if (typeof parsed.r === 'string') out.redirectAfter = parsed.r;
    if (parsed.i === 'signin' || parsed.i === 'link') out.intent = parsed.i;
    return out;
  } catch {
    return {};
  }
}

export function makeBlueskyAuthClient(cfg: BlueskyClientConfig): BlueskyAuthClient {
  const stateStore = makeRedisStateStore({ redis: cfg.redis });
  const sessionStore = makeRedisSessionStore({ redis: cfg.redis });
  const { clientId, metadata } = resolveClientMetadata(cfg);
  void clientId; // resolved into metadata.client_id, kept for diagnostics

  // Circuit breaker on the underlying restore() call. If bsky.social is
  // unreachable we trip after 50% errors over the default window and stay
  // open for 30s before half-open; saga callers see external_unavailable
  // and the bridge marks bridgeStatus='failed' rather than blocking.
  const restoreBreakered = wrapBreaker(
    {
      name: 'bsky.restoreSession',
      timeoutMs: 8000,
      errorThresholdPercent: 50,
      resetTimeoutMs: 30_000,
    },
    async (did: string) => {
      const { client } = await getClient();
      return client.restore(did);
    },
  );

  // Defer NodeOAuthClient construction until first use: the constructor
  // validates the metadata document, which is expensive, and a process that
  // never authenticates a Bluesky user (e.g. a worker) should not pay it.
  let deferred: DeferredClient | null = null;
  const getClient = async (): Promise<DeferredClient> => {
    if (deferred) return deferred;
    const client = new NodeOAuthClient({
      clientMetadata: metadata,
      stateStore,
      sessionStore,
      ...(cfg.allowHttp ? { allowHttp: true } : {}),
    });
    deferred = { client, metadata };
    return deferred;
  };

  const sessionFromAuth = (saved: NodeSavedSession): OAuthProfile => {
    const sub = saved.tokenSet.sub;
    return {
      provider: 'bluesky',
      subject: sub,
      did: sub,
      displayName: sub,
    };
  };

  return {
    provider: 'bluesky',
    clientMetadata: () => ({ ...metadata }),
    authorize({ handle, redirectAfter, intent }) {
      const work = async (): Promise<{ url: string }> => {
        const { client } = await getClient();
        // The state token comes back to us through the callback URL params;
        // we pack the post-auth navigation target into it so the callback
        // handler can redirect the browser back to where the user started.
        const state =
          redirectAfter || intent ? encodeCallbackState({ redirectAfter, intent }) : undefined;
        const url = await client.authorize(handle, {
          ...(state ? { state } : {}),
          scope: 'atproto transition:generic',
        });
        return { url: url.toString() };
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('bluesky.authorize', cause),
      );
    },
    callback(params) {
      const work = async (): Promise<{
        profile: OAuthProfile;
        did: string;
        redirectAfter?: string;
        intent?: BlueskyAuthIntent;
      }> => {
        const { client } = await getClient();
        const { session, state } = await client.callback(params);
        const sub = session.did;
        const stored = await sessionStore.get(sub);
        const base: OAuthProfile = stored
          ? sessionFromAuth(stored)
          : { provider: 'bluesky', subject: sub, did: sub, displayName: sub };
        // Try resolving the actor profile once — best effort,
        // a failure shouldn't block sign-in.
        let handle: string | undefined;
        let displayName: string | undefined;
        let avatarUrl: string | undefined;
        try {
          const agent = new Agent(session);
          const profile = await agent.app.bsky.actor.getProfile({ actor: sub });
          if (typeof profile.data.handle === 'string' && profile.data.handle.length > 0) {
            handle = profile.data.handle;
          }
          if (typeof profile.data.displayName === 'string' && profile.data.displayName.length > 0) {
            displayName = profile.data.displayName;
          }
          if (typeof profile.data.avatar === 'string' && profile.data.avatar.length > 0) {
            avatarUrl = profile.data.avatar;
          }
        } catch {
          try {
            const agent = new Agent(session);
            const me = await agent.com.atproto.repo.describeRepo({ repo: sub });
            if (typeof me.data.handle === 'string' && me.data.handle.length > 0) {
              handle = me.data.handle;
            }
          } catch {
            // ignore: profile still usable with just did
          }
        }
        const parsedState = parseCallbackState(state ?? undefined);
        const profile: OAuthProfile = {
          ...base,
          ...(handle ? { handle } : {}),
          displayName: displayName ?? handle ?? base.displayName,
          ...(avatarUrl ? { avatarUrl } : {}),
        };
        const result: {
          profile: OAuthProfile;
          did: string;
          redirectAfter?: string;
          intent?: BlueskyAuthIntent;
        } = {
          profile,
          did: sub,
        };
        if (parsedState.redirectAfter !== undefined) result.redirectAfter = parsedState.redirectAfter;
        if (parsedState.intent !== undefined) result.intent = parsedState.intent;
        return result;
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('bluesky.callback', cause),
      );
    },
    restoreSession(did) {
      return restoreBreakered(did).map((session) => {
        const agent = new Agent(session);
        return makeAgentSessionImpl(did, agent, session);
      });
    },
    hasSession(did) {
      const work = async (): Promise<boolean> => {
        const session = await sessionStore.get?.(did);
        return Boolean(session);
      };
      return fromPromise(
        work(),
        (cause) => Errors.externalInvalidResponse('bluesky.hasSession', cause),
      );
    },
    revoke(did) {
      const work = async (): Promise<void> => {
        const { client } = await getClient();
        const session = await client.restore(did).catch(() => null);
        if (session) {
          try {
            await session.signOut();
          } catch {
            // session.signOut() also nukes the store entry; if it errored
            // we still want to clean up locally below.
          }
        }
        await sessionStore.del(did);
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('bluesky.revoke', cause),
      );
    },
  };
}

function makeAgentSessionImpl(
  did: string,
  agent: Agent,
  oauthSession: { serverMetadata: { issuer: string }; fetchHandler: (path: string, init?: RequestInit) => Promise<Response> },
): BlueskyAgentSession {
  return {
    did,
    serviceUrl: oauthSession.serverMetadata.issuer,
    post<T>(nsid: string, body: unknown): AppResultAsync<T> {
      void agent; // agent is retained for future ergonomic XRPC calls
      return fromPromise(
        (async (): Promise<T> => {
          const res = await oauthSession.fetchHandler(`/xrpc/${nsid}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`bsky ${nsid} ${res.status}: ${text.slice(0, 500)}`);
          }
          return (await res.json()) as T;
        })(),
        (cause) => Errors.externalInvalidResponse(`bsky.${nsid}`, cause),
      );
    },
    get<T>(nsid: string, query: Record<string, string> = {}): AppResultAsync<T> {
      return fromPromise(
        (async (): Promise<T> => {
          const qs = new URLSearchParams(query).toString();
          const path = `/xrpc/${nsid}${qs ? `?${qs}` : ''}`;
          const res = await oauthSession.fetchHandler(path, { method: 'GET' });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`bsky ${nsid} ${res.status}: ${text.slice(0, 500)}`);
          }
          return (await res.json()) as T;
        })(),
        (cause) => Errors.externalInvalidResponse(`bsky.${nsid}`, cause),
      );
    },
    uploadBlob(data, mimeType) {
      return fromPromise(
        (async (): Promise<BlobRef> => {
          const res = await oauthSession.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
            method: 'POST',
            headers: { 'content-type': mimeType },
            body: data,
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`bsky uploadBlob ${res.status}: ${text.slice(0, 500)}`);
          }
          const { blob } = (await res.json()) as { blob: BlobRef };
          return blob;
        })(),
        (cause) => Errors.externalInvalidResponse('bsky.uploadBlob', cause),
      );
    },
  };
}

/**
 * Mock client used when USE_MOCK_BLUESKY=true. Generates deterministic-ish
 * fake DIDs and never touches the network. Sessions returned from
 * `restoreSession` succeed but never actually write to a PDS — the bridge
 * detects mock mode and skips real posting.
 */
export function makeMockBlueskyAuthClient(redis: Redis): BlueskyAuthClient {
  void redis;
  const mockSessions = new Map<string, BlueskyAgentSession>();
  return {
    provider: 'bluesky',
    clientMetadata: () => ({ client_id: 'mock', client_name: 'OpenXiv (mock)' }),
    authorize({ redirectAfter, intent }) {
      const did = `did:plc:mock${Math.random().toString(36).slice(2, 10)}`;
      const state = encodeCallbackState({ redirectAfter, intent });
      const url = `/auth/dev/mock-callback?provider=bluesky&code=${Buffer.from(
        JSON.stringify({ did, handle: `${did}.mock.bsky` }),
      ).toString('base64url')}&state=${encodeURIComponent(state)}${
        redirectAfter ? `&redirect_after=${encodeURIComponent(redirectAfter)}` : ''
      }`;
      return ResultAsync.fromSafePromise(Promise.resolve({ url }));
    },
    callback(params) {
      const code = params.get('code') ?? '';
      const parsedState = parseCallbackState(params.get('state') ?? undefined);
      try {
        const parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
        const profile: OAuthProfile = {
          provider: 'bluesky',
          subject: parsed.did,
          did: parsed.did,
          handle: parsed.handle,
          displayName: parsed.handle ?? parsed.did,
        };
        mockSessions.set(parsed.did, makeMockAgentSession(parsed.did));
        return ResultAsync.fromSafePromise(
          Promise.resolve({
            profile,
            did: parsed.did,
            ...(parsedState.redirectAfter ? { redirectAfter: parsedState.redirectAfter } : {}),
            ...(parsedState.intent ? { intent: parsedState.intent } : {}),
          }),
        );
      } catch {
        return fromPromise(
          Promise.reject(new Error('mock callback: bad code')),
          () => Errors.validation('mock-bluesky-callback'),
        );
      }
    },
    hasSession(did) {
      return ResultAsync.fromSafePromise(Promise.resolve(mockSessions.has(did)));
    },
    restoreSession(did) {
      let session = mockSessions.get(did);
      if (!session) {
        session = makeMockAgentSession(did);
        mockSessions.set(did, session);
      }
      return ResultAsync.fromSafePromise(Promise.resolve(session));
    },
    revoke(did) {
      mockSessions.delete(did);
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
  };
}

function makeMockAgentSession(did: string): BlueskyAgentSession {
  return {
    did,
    serviceUrl: 'mock://bsky.local',
    post<T>(nsid: string, body: unknown): AppResultAsync<T> {
      void body;
      const uri = new AtUri(`at://${did}/${nsid}/mock${Math.random().toString(36).slice(2, 8)}`);
      const fake = {
        uri: uri.toString(),
        cid: `mock-cid-${Math.random().toString(36).slice(2, 10)}`,
      } as unknown as T;
      return ResultAsync.fromSafePromise(Promise.resolve(fake));
    },
    get<T>(): AppResultAsync<T> {
      return ResultAsync.fromSafePromise(Promise.resolve({} as T));
    },
    uploadBlob(data, mimeType) {
      const blob: BlobRef = {
        $type: 'blob',
        ref: { $link: `mock-${Math.random().toString(36).slice(2, 10)}` },
        mimeType,
        size: data.length,
      };
      return ResultAsync.fromSafePromise(Promise.resolve(blob));
    },
  };
}

void JoseKey;

export const __testing = {
  encodeCallbackState,
  parseCallbackState,
};
