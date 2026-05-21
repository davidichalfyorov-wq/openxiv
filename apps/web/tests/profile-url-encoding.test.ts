import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

/**
 * Property tests for the profile URL pipeline.
 *
 * Repro of the bug we're guarding against:
 *   1. Base.astro renders `<a href="/@{did}">` where {did} contains colons.
 *   2. Browser navigates. Astro decodes `Astro.params.handle` → raw DID.
 *   3. @[handle].astro 301s to `/u/{decoded-did}`.
 *   4. /u/[handle].astro calls client.profile(handle) → encodes ONCE for HTTP.
 *
 * If ANY of steps 1, 2, or 3 also call encodeURIComponent we end up with
 * `%3A` becoming `%253A`, and the API sees a double-encoded path it cannot
 * decode back to a valid DID. The pre-fix Base.astro + @[handle].astro
 * both encoded — that's why ORCID/Google users 404'd on profile click.
 *
 * These tests assert the contract: the URL the browser places in its bar
 * after the full hop, decoded as the API would, must equal the original
 * identifier. And the URL string itself must never contain `%25` (the
 * tell-tale signature of double-encoding).
 */

// Mirror of the production flow.
function baseAstroHref(handle: string | null, did: string): string {
  return `/@${handle ?? did}`;
}
function astroParamDecode(seg: string): string {
  // Astro auto-decodes dynamic URL segments.
  return decodeURIComponent(seg);
}
function atHandleAstroRedirect(handleFromParam: string): string {
  return `/u/${handleFromParam}`;
}
function uHandleAstroFetch(handleFromParam: string): string {
  return `/profiles/${encodeURIComponent(handleFromParam)}`;
}
function fastifyParamDecode(seg: string): string {
  return decodeURIComponent(seg);
}

const DID_PLC = fc
  .stringMatching(/^[a-z2-7]{16,24}$/)
  .map((s) => `did:plc:${s}`);
const DID_WEB = fc
  .stringMatching(/^[a-z0-9.-]{1,40}$/)
  .map((s) => `did:web:openxiv.net:u:orcid.${s}`);
const HANDLE = fc.stringMatching(/^[a-z][a-z0-9-]{2,30}\.openxiv\.net$/);

describe('Profile URL pipeline — no double encoding', () => {
  it('clicking did fallback round-trips DID through the pipeline byte-exact', () => {
    fc.assert(
      fc.property(fc.oneof(DID_PLC, DID_WEB), (did) => {
        // Step 1: Base.astro renders the link with the raw DID.
        const baseHref = baseAstroHref(null, did);
        // Step 2: Browser percent-encodes the URL on the wire. URL stores
        // pathname as-encoded; we model by encoding the `did:` substring
        // path-segment via encodeURIComponent on just the segment.
        const onWire = `/@${encodeURIComponent(did)}`;
        // Step 3: Astro decodes the path segment for @[handle].astro.
        const handleParam = astroParamDecode(onWire.slice(2));
        // Step 4: Redirect URL the new page sees.
        const redirectTo = atHandleAstroRedirect(handleParam);
        const wireForU = `/u/${encodeURIComponent(handleParam)}`;
        // Step 5: u/[handle].astro receives the decoded handle.
        const uHandle = astroParamDecode(wireForU.slice(3));
        // Step 6: API call URL.
        const apiPath = uHandleAstroFetch(uHandle);
        // Step 7: Fastify decodes the param.
        const fastifyIdent = fastifyParamDecode(apiPath.slice('/profiles/'.length));
        expect(fastifyIdent).toBe(did);
        // The on-wire URLs must never have %25 except as part of legitimately
        // pre-encoded `%` in the source DID — which our DIDs never contain.
        expect(baseHref).not.toContain('%25');
        expect(onWire).not.toContain('%25');
        expect(redirectTo).not.toContain('%25');
        expect(wireForU).not.toContain('%25');
        expect(apiPath).not.toContain('%25');
      }),
      { numRuns: 200 },
    );
  });

  it('clicking handle round-trips through every layer byte-exact', () => {
    fc.assert(
      fc.property(HANDLE, (handle) => {
        const baseHref = baseAstroHref(handle, 'did:irrelevant');
        const onWire = `/@${encodeURIComponent(handle)}`;
        const handleParam = astroParamDecode(onWire.slice(2));
        const redirectTo = atHandleAstroRedirect(handleParam);
        const wireForU = `/u/${encodeURIComponent(handleParam)}`;
        const uHandle = astroParamDecode(wireForU.slice(3));
        const apiPath = uHandleAstroFetch(uHandle);
        const fastifyIdent = fastifyParamDecode(apiPath.slice('/profiles/'.length));
        expect(fastifyIdent).toBe(handle);
        expect(baseHref).not.toContain('%');
        expect(onWire).not.toContain('%25');
        expect(redirectTo).not.toContain('%25');
        expect(wireForU).not.toContain('%25');
        expect(apiPath).not.toContain('%25');
      }),
      { numRuns: 100 },
    );
  });

  it('explicit regression: did:web:openxiv.net:u:orcid.0009-... never produces %253A', () => {
    const did = 'did:web:openxiv.net:u:orcid.0009-0009-1942-0078';
    const onWire = `/@${encodeURIComponent(did)}`;
    expect(onWire).toBe('/@did%3Aweb%3Aopenxiv.net%3Au%3Aorcid.0009-0009-1942-0078');
    expect(onWire).not.toContain('%253A');
    const handleParam = astroParamDecode(onWire.slice(2));
    expect(handleParam).toBe(did);
    const wireForU = `/u/${encodeURIComponent(handleParam)}`;
    expect(wireForU).not.toContain('%253A');
    const apiPath = uHandleAstroFetch(astroParamDecode(wireForU.slice(3)));
    expect(apiPath).toBe(
      '/profiles/did%3Aweb%3Aopenxiv.net%3Au%3Aorcid.0009-0009-1942-0078',
    );
    expect(apiPath).not.toContain('%253A');
    expect(fastifyParamDecode(apiPath.slice('/profiles/'.length))).toBe(did);
  });
});
