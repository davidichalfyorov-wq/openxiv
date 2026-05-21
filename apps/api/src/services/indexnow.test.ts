import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../context.js';
import { paperCanonicalUrl, submitToIndexNow } from './indexnow.js';

const VALID_KEY = 'a1b2c3d4e5f67890a1b2c3d4e5f67890';

function mkCtx(
  overrides?: Partial<{ key: string; webBase: string }>,
): AppContext {
  return {
    env: {
      INDEXNOW_KEY: overrides?.key ?? VALID_KEY,
      PUBLIC_WEB_BASE: overrides?.webBase ?? 'https://openxiv.net',
    },
  } as unknown as AppContext;
}

describe('submitToIndexNow', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips when key is empty', async () => {
    const res = await submitToIndexNow(mkCtx({ key: '' }), [
      'https://openxiv.net/p/cs.AI.2026.00001',
    ]);
    expect(res).toEqual({ attempted: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('skips when key fails character validation', async () => {
    const res = await submitToIndexNow(mkCtx({ key: 'bad/key!' }), [
      'https://openxiv.net/p/x',
    ]);
    expect(res.attempted).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('skips when key is shorter than 8 chars', async () => {
    const res = await submitToIndexNow(mkCtx({ key: 'short' }), [
      'https://openxiv.net/p/x',
    ]);
    expect(res.attempted).toBe(false);
  });

  it('skips when no URLs are supplied', async () => {
    const res = await submitToIndexNow(mkCtx(), []);
    expect(res).toEqual({ attempted: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('filters out foreign-host URLs before submission', async () => {
    await submitToIndexNow(mkCtx(), [
      'https://example.com/foo',
      'https://openxiv.net/p/x',
      'not-a-url',
    ]);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((callArgs[1] as RequestInit).body as string) as {
      urlList: string[];
    };
    expect(body.urlList).toEqual(['https://openxiv.net/p/x']);
  });

  it('does not ping when every URL is foreign-host', async () => {
    const res = await submitToIndexNow(mkCtx(), ['https://example.com/foo']);
    expect(res.attempted).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('de-duplicates URLs before submission', async () => {
    await submitToIndexNow(mkCtx(), [
      'https://openxiv.net/p/x',
      'https://openxiv.net/p/x',
      'https://openxiv.net/p/y',
    ]);
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((callArgs[1] as RequestInit).body as string) as {
      urlList: string[];
    };
    expect(body.urlList).toHaveLength(2);
  });

  it('reports ok=true on HTTP 200', async () => {
    const res = await submitToIndexNow(mkCtx(), ['https://openxiv.net/p/x']);
    expect(res).toEqual({ attempted: true, status: 200, ok: true });
  });

  it('reports ok=true on HTTP 202 (key validation pending)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 202 }),
    );
    const res = await submitToIndexNow(mkCtx(), ['https://openxiv.net/p/x']);
    expect(res).toEqual({ attempted: true, status: 202, ok: true });
  });

  it('reports ok=false on HTTP 422 (host mismatch / bad schema)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 422 }),
    );
    const res = await submitToIndexNow(mkCtx(), ['https://openxiv.net/p/x']);
    expect(res.attempted).toBe(true);
    expect(res.status).toBe(422);
    expect(res.ok).toBe(false);
  });

  it('reports ok=false on HTTP 429 (rate-limit)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 429 }),
    );
    const res = await submitToIndexNow(mkCtx(), ['https://openxiv.net/p/x']);
    expect(res.ok).toBe(false);
  });

  it('swallows network errors without throwing', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new Error('network down'),
    );
    const res = await submitToIndexNow(mkCtx(), ['https://openxiv.net/p/x']);
    expect(res.attempted).toBe(false);
    expect(res.error).toBe('network down');
  });

  it('returns false when PUBLIC_WEB_BASE is malformed', async () => {
    const res = await submitToIndexNow(mkCtx({ webBase: 'not a url' }), [
      'https://openxiv.net/p/x',
    ]);
    expect(res.attempted).toBe(false);
  });
});

describe('paperCanonicalUrl', () => {
  it('strips the "openxiv:" prefix and routes to /p/', () => {
    expect(
      paperCanonicalUrl('https://openxiv.net', 'openxiv:cs.AI.2026.00117', 'uuid'),
    ).toBe('https://openxiv.net/p/cs.AI.2026.00117');
  });

  it('passes the slug through when there is no openxiv: prefix', () => {
    expect(paperCanonicalUrl('https://openxiv.net', 'math.AG.2026.99', 'uuid')).toBe(
      'https://openxiv.net/p/math.AG.2026.99',
    );
  });

  it('falls back to /paper/{uuid} when openxivId is null', () => {
    expect(paperCanonicalUrl('https://openxiv.net', null, 'fallback-id')).toBe(
      'https://openxiv.net/paper/fallback-id',
    );
  });

  it('strips trailing slash from the base URL', () => {
    expect(paperCanonicalUrl('https://openxiv.net/', 'openxiv:x', 'y')).toBe(
      'https://openxiv.net/p/x',
    );
  });
});
