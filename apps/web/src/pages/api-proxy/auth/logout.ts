import type { APIRoute } from 'astro';

const API_BASE =
  (typeof process !== 'undefined' && process.env?.INTERNAL_API_BASE) ||
  (typeof process !== 'undefined' && process.env?.PUBLIC_API_BASE) ||
  import.meta.env.PUBLIC_API_BASE ||
  'http://localhost:4000';

/**
 * Astro proxy for /auth/logout — needed because the browser cookie sits on the
 * web origin (port 4321) but the API runs on a different origin (port 4000).
 * The Astro endpoint receives the form POST same-origin, forwards to the API
 * with the cookie, and mirrors the Set-Cookie back to the browser.
 */
export const POST: APIRoute = async ({ request }) => {
  const cookie = request.headers.get('cookie') ?? '';
  const apiRes = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { cookie },
  });

  const headers = new Headers();
  const setCookies = apiRes.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) headers.append('set-cookie', sc);
  headers.set('location', '/');

  return new Response(null, { status: 302, headers });
};
