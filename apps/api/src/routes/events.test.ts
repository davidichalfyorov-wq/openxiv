import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptAll, serializeConsent } from '@openxiv/shared';

/**
 * Integration tests for POST /api/events/track against the running dev
 * server. These exercise the full stack — Fastify route, idempotency probe
 * against real Postgres, the privacy gates, and the rate-limit shape —
 * because event ingestion is one of those features where the unit-test
 * version would just re-state the implementation. The cost is that the
 * tests require `pnpm dev` for @openxiv/api and a running Postgres on the
 * compose stack; they auto-skip if either is unreachable.
 */
const BASE = process.env['INTEGRATION_API_BASE'] ?? 'http://localhost:4000';
const CONSENT_COOKIE = `openxiv_consent=${serializeConsent(acceptAll())}`;

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

function newSessionId(): string {
  return 'sess-' + Math.random().toString(36).slice(2, 14);
}

async function track(body: Record<string, unknown>, init: RequestInit = {}): Promise<{
  status: number;
  json: { accepted: boolean; reason?: string } | { error?: string } | Record<string, unknown>;
}> {
  const res = await fetch(`${BASE}/api/events/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: CONSENT_COOKIE, ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe.skipIf(process.env['CI_SKIP_INTEGRATION'] === '1')('POST /api/events/track', () => {
  let available = false;
  beforeAll(async () => {
    available = await reachable();
  });
  afterAll(() => undefined);

  it('accepts a valid event', async () => {
    if (!available) return;
    const r = await track({
      sessionId: newSessionId(),
      eventType: 'feed_impression',
      targetUri: 'at://did:plc:abc/app.openxiv.paper/test-' + Math.random(),
      targetType: 'openxiv_paper',
    });
    expect(r.status).toBe(200);
    expect((r.json as { accepted: boolean }).accepted).toBe(true);
  });

  it('accepts product analytics event types used by the real web flow', async () => {
    if (!available) return;
    for (const eventType of [
      'paper_view',
      'pdf_download',
      'html_open',
      'profile_view',
      'endorse_click',
      'endorse_submit',
      'search_query',
      'signup_complete',
      'submit_complete',
    ]) {
      const r = await track({
        sessionId: newSessionId(),
        eventType,
        targetUri: `openxiv:test-${eventType}-${Math.random()}`,
        targetType: eventType === 'profile_view' ? 'profile' : 'openxiv_paper',
        context: { referrerHost: 'example.test' },
      });
      expect(r.status, eventType).toBe(200);
      expect((r.json as { accepted: boolean }).accepted, eventType).toBe(true);
    }
  });

  it('rejects an unknown event_type with 400', async () => {
    if (!available) return;
    const r = await track({
      sessionId: newSessionId(),
      eventType: 'definitely_not_an_event',
      targetUri: 'at://x',
      targetType: 'openxiv_paper',
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a malformed session_id', async () => {
    if (!available) return;
    const r = await track({
      sessionId: 'with spaces',
      eventType: 'feed_impression',
      targetUri: 'at://x',
      targetType: 'openxiv_paper',
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('drops a duplicate within the 60s bucket', async () => {
    if (!available) return;
    const sess = newSessionId();
    const uri = 'at://did:plc:abc/app.openxiv.paper/dup-' + Math.random();
    const first = await track({ sessionId: sess, eventType: 'card_expand', targetUri: uri, targetType: 'openxiv_paper' });
    expect((first.json as { accepted: boolean }).accepted).toBe(true);
    const second = await track({ sessionId: sess, eventType: 'card_expand', targetUri: uri, targetType: 'openxiv_paper' });
    expect((second.json as { accepted: boolean; reason: string }).accepted).toBe(false);
    expect((second.json as { reason: string }).reason).toBe('duplicate');
  });

  it('does NOT dedupe across different sessions on the same uri', async () => {
    if (!available) return;
    const uri = 'at://did:plc:abc/app.openxiv.paper/multi-' + Math.random();
    const a = await track({ sessionId: newSessionId(), eventType: 'card_expand', targetUri: uri, targetType: 'openxiv_paper' });
    const b = await track({ sessionId: newSessionId(), eventType: 'card_expand', targetUri: uri, targetType: 'openxiv_paper' });
    expect((a.json as { accepted: boolean }).accepted).toBe(true);
    expect((b.json as { accepted: boolean }).accepted).toBe(true);
  });

  it('honors the DNT header — returns 200 but does not store', async () => {
    if (!available) return;
    const sess = newSessionId();
    const uri = 'at://did:plc:abc/app.openxiv.paper/dnt-' + Math.random();
    const r = await track(
      { sessionId: sess, eventType: 'feed_impression', targetUri: uri, targetType: 'openxiv_paper' },
      { headers: { dnt: '1' } },
    );
    expect(r.status).toBe(200);
    expect((r.json as { accepted: boolean; reason: string }).accepted).toBe(false);
    expect((r.json as { reason: string }).reason).toBe('opt_out');
  });

  it('honors the opt-out cookie — same shape as DNT', async () => {
    if (!available) return;
    const r = await track(
      {
        sessionId: newSessionId(),
        eventType: 'feed_impression',
        targetUri: 'at://did:plc:abc/cookie-opt-' + Math.random(),
        targetType: 'openxiv_paper',
      },
      { headers: { cookie: 'openxiv_notrack=1' } },
    );
    expect((r.json as { accepted: boolean; reason: string }).reason).toBe('opt_out');
  });

  it('honors missing analytics consent — same shape as DNT', async () => {
    if (!available) return;
    const r = await track(
      {
        sessionId: newSessionId(),
        eventType: 'paper_view',
        targetUri: 'at://did:plc:abc/no-consent-' + Math.random(),
        targetType: 'openxiv_paper',
      },
      { headers: { cookie: '' } },
    );
    expect((r.json as { accepted: boolean; reason: string }).reason).toBe('opt_out');
  });

  it('accepts anonymous (no session cookie) events', async () => {
    if (!available) return;
    const r = await track({
      sessionId: newSessionId(),
      eventType: 'save',
      targetUri: 'at://did:plc:abc/anon-' + Math.random(),
      targetType: 'openxiv_paper',
    });
    expect((r.json as { accepted: boolean }).accepted).toBe(true);
  });
});
