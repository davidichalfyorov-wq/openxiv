import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, serverClient } from './api';

describe('ApiClient Bluesky auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts Bluesky OAuth through the dedicated POST endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ url: 'https://bsky.social/oauth/authorize' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient('https://openxiv.test');
    const result = await client.startBlueskyAuth({
      handle: 'ddavidich.bsky.social',
      redirectAfter: '/settings/identity',
      intent: 'link',
    });

    expect(result.url).toBe('https://bsky.social/oauth/authorize');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openxiv.test/api/auth/bluesky/start');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      handle: 'ddavidich.bsky.social',
      redirect_after: '/settings/identity',
      intent: 'link',
    });
  });
});

describe('serverClient SSR forwarding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards the real viewer IP headers on server-side API calls', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://openxiv.test/abs/openxiv:gr-qc.2026.00001', {
      headers: {
        cookie: 'session=abc',
        'x-forwarded-for': '198.51.100.42',
        'x-real-ip': '198.51.100.42',
      },
    });

    await serverClient('session=abc', request).me();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Headers;
    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('x-forwarded-for')).toBe('198.51.100.42');
    expect(headers.get('x-real-ip')).toBe('198.51.100.42');
  });
});
