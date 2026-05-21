import { describe, expect, it } from 'vitest';

/**
 * LIVE integration tests against bsky.social and jetstream. These make real
 * HTTP calls — they are NOT mocked, NOT stubbed, NOT skipped. They fail loud
 * when the network is unreachable or the PDS changes its API shape.
 *
 * Authenticated tests (write a record, read it back, delete it) require a
 * test account with phone verification. That's a one-shot the operator does
 * by hand at go-live; the unauthenticated probes here cover the contract
 * surface our client/bridge depends on.
 *
 * What is verified here against the LIVE production endpoint:
 *   • The configured PDS (bsky.social) is reachable and returns sane JSON.
 *   • The OAuth Authorization Server metadata document advertises every
 *     capability our NodeOAuthClient assumes (S256 PKCE, DPoP, PAR).
 *   • The jetstream upgrade endpoint is reachable (HTTP 200 on the GET form).
 *   • createSession's negative path returns the documented error shape.
 */

const PDS = process.env['ATPROTO_SERVICE_URL'] ?? 'https://bsky.social';
const JETSTREAM_HTTP =
  process.env['JETSTREAM_PROBE_URL'] ?? 'https://jetstream2.us-east.bsky.network/';
const TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 401) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

describe('Bluesky LIVE integration (network)', () => {
  it('describeServer on the configured PDS returns AT-proto-compliant JSON', async () => {
    interface DescribeServer {
      did: string;
      availableUserDomains: string[];
      inviteCodeRequired: boolean;
      links?: { privacyPolicy?: string; termsOfService?: string };
    }
    const body = await fetchJson<DescribeServer>(`${PDS}/xrpc/com.atproto.server.describeServer`);
    expect(body.did).toMatch(/^did:(plc|web):/);
    expect(Array.isArray(body.availableUserDomains)).toBe(true);
    expect(body.availableUserDomains.length).toBeGreaterThan(0);
    expect(typeof body.inviteCodeRequired).toBe('boolean');
  });

  it('OAuth AS metadata declares every capability NodeOAuthClient depends on', async () => {
    interface AsMetadata {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      pushed_authorization_request_endpoint?: string;
      require_pushed_authorization_requests?: boolean;
      code_challenge_methods_supported?: string[];
      dpop_signing_alg_values_supported?: string[];
      response_types_supported?: string[];
      grant_types_supported?: string[];
      scopes_supported?: string[];
      client_id_metadata_document_supported?: boolean;
    }
    const meta = await fetchJson<AsMetadata>(`${PDS}/.well-known/oauth-authorization-server`);

    // Issuer must match the PDS we're talking to.
    expect(new URL(meta.issuer).host).toBe(new URL(PDS).host);
    // PAR is REQUIRED by the spec; our client always pushes through PAR.
    expect(meta.pushed_authorization_request_endpoint).toMatch(/^https:\/\//);
    expect(meta.require_pushed_authorization_requests).toBe(true);
    // PKCE S256 is the only method our client uses.
    expect(meta.code_challenge_methods_supported).toContain('S256');
    // DPoP is mandatory for token use.
    expect(meta.dpop_signing_alg_values_supported?.length).toBeGreaterThan(0);
    expect(meta.dpop_signing_alg_values_supported).toContain('ES256');
    // Authorization code + refresh_token are the flow we ship.
    expect(meta.grant_types_supported).toContain('authorization_code');
    expect(meta.grant_types_supported).toContain('refresh_token');
    // atproto scope must exist (our scope string is "atproto transition:generic").
    expect(meta.scopes_supported).toContain('atproto');
    // We deliver client metadata via a URL (not pre-registered): this MUST be true.
    expect(meta.client_id_metadata_document_supported).toBe(true);
  });

  it('jetstream HTTPS endpoint is reachable on the configured region', async () => {
    const res = await fetch(JETSTREAM_HTTP, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    // HTTP 200 means the WebSocket upgrade endpoint is alive and responding
    // to plain GET (or HEAD). 426 (Upgrade Required) is also valid — bsky's
    // jetstream returns 200 with a small marketing page on GET.
    expect([200, 426]).toContain(res.status);
  });

  it('createSession negative path returns the documented AT-proto error shape', async () => {
    // Use a handle that almost certainly doesn't exist on the PDS and a
    // throwaway password. The PDS should reject the login with HTTP 400/401
    // and may return HTTP 429 during repeated live probes. In every case the
    // JSON body must keep the AT-proto error shape our auth client maps.
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identifier: 'openxiv-integration-probe-does-not-exist-12345.bsky.social',
        password: 'definitely-not-right',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    expect([400, 401, 429]).toContain(res.status);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(typeof body.error).toBe('string');
    expect(typeof body.message).toBe('string');
    expect(body.error!.length).toBeGreaterThan(0);
    if (res.status === 429) {
      expect(`${body.error} ${body.message}`).toMatch(/rate|limit|too many/i);
    }
  });

  it('resolveHandle for a known public handle returns a did:plc identifier', async () => {
    // bsky.app's own handle is the most stable public identity. If this
    // breaks the entire identity resolver pipeline is broken upstream.
    interface ResolveHandle {
      did: string;
    }
    const body = await fetchJson<ResolveHandle>(
      `${PDS}/xrpc/com.atproto.identity.resolveHandle?handle=bsky.app`,
    );
    expect(body.did).toMatch(/^did:(plc|web):/);
  });
});
