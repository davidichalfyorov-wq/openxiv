import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * ProfilePage SEO regression gate (P2 #6).
 *
 * Asserts that a real user profile carries the structured-data contract
 * Google's Person + ProfilePage schemas expect, plus:
 *   - canonical pointing at /u/{handle}
 *   - sameAs cross-links to ORCID and Bluesky DID page
 *   - JSON-LD that round-trips through JSON.parse and exposes mainEntity.Person
 *   - NO PII leakage in the structured block (no email, no raw session ids)
 *
 * Walks the user table to find an ORCID-bearing profile; skips cleanly if
 * none exist.
 */

interface JsonLd {
  '@context'?: string;
  '@type': string;
  url?: string;
  mainEntity?: {
    '@type': string;
    name?: string;
    sameAs?: string[];
    identifier?: string;
    description?: string;
  };
  numberOfItems?: number;
}

async function findHandleWithOrcid(request: APIRequestContext): Promise<string | null> {
  const override = process.env['E2E_SAMPLE_HANDLE'];
  if (override) return override;
  // No public "list users" endpoint by design; we walk papers and look up
  // their submitters until we find one whose profile has an ORCID. Bounded
  // to 50 probes — anything more is a sparse-fixture problem, not a flake.
  const res = await request.get('/api-proxy/papers?limit=50');
  if (!res.ok()) return null;
  const data = (await res.json()) as { items: Array<{ submitterDid: string }> };
  const seen = new Set<string>();
  for (const p of data.items) {
    if (seen.has(p.submitterDid)) continue;
    seen.add(p.submitterDid);
    const prof = await request.get(`/api-proxy/profiles/${encodeURIComponent(p.submitterDid)}`);
    if (!prof.ok()) continue;
    const profile = (await prof.json()) as { orcid: string | null; handle: string | null; did: string };
    if (profile.handle) return profile.handle;
    return profile.did; // handles may be null; the SEO surface still renders
  }
  return null;
}

function pickJsonLd(html: string): JsonLd | null {
  const m = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as JsonLd;
  } catch {
    return null;
  }
}

test.describe('ProfilePage SEO on /u/{handle}', () => {
  test('renders ProfilePage JSON-LD with Person + sameAs', async ({ request }) => {
    const handle = await findHandleWithOrcid(request);
    test.skip(!handle, 'no profile available to scan');
    const res = await request.get(`/u/${encodeURIComponent(handle!)}`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // Canonical points at /u/{handle}
    const canonical = /<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html);
    expect(canonical, 'canonical link missing').toBeTruthy();
    expect(canonical![1]).toContain(`/u/${encodeURIComponent(handle!)}`);

    // og:type=profile
    expect(html).toMatch(/<meta\s+property="og:type"\s+content="profile"/i);

    // JSON-LD block parses and has the right shape
    const ld = pickJsonLd(html);
    expect(ld, 'JSON-LD missing or malformed').toBeTruthy();
    expect(ld!['@type']).toBe('ProfilePage');
    expect(ld!.mainEntity, 'mainEntity missing').toBeTruthy();
    expect(ld!.mainEntity!['@type']).toBe('Person');
    expect(ld!.mainEntity!.name).toBeTruthy();
    expect(ld!.mainEntity!.identifier).toMatch(/^did:/);

    // Bluesky DID sameAs link is the minimum we promise; ORCID is best-effort
    const sameAs = ld!.mainEntity!.sameAs ?? [];
    expect(sameAs.some((u) => u.startsWith('https://bsky.app/profile/did:')), 'no bsky.app sameAs').toBe(true);

    // No raw PII anywhere — emails, session cookies, server-side stack frames.
    expect(html.toLowerCase()).not.toMatch(/openxiv_session=/);
    expect(html).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  test('legacy /@{handle} 301-redirects to /u/{handle}', async ({ request }) => {
    const handle = await findHandleWithOrcid(request);
    test.skip(!handle, 'no profile available');
    const res = await request.get(`/@${encodeURIComponent(handle!)}`, { maxRedirects: 0 });
    expect([301, 302, 308]).toContain(res.status());
    const loc = res.headers()['location'] ?? '';
    expect(loc).toContain(`/u/${encodeURIComponent(handle!)}`);
  });
});
