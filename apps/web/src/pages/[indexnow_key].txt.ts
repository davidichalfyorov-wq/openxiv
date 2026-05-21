import type { APIRoute } from 'astro';

/**
 * IndexNow ownership verification endpoint.
 *
 * IndexNow requires the host to serve a file at
 * `https://<host>/{KEY}.txt` containing exactly the key as plain text
 * (https://www.indexnow.org/documentation). We deliberately do NOT commit
 * the key file into /public/ — instead this dynamic route returns the key
 * iff the URL slug equals the env-configured value, so the key lives only
 * in the INDEXNOW_KEY environment variable and can be rotated by ops
 * without touching the file tree.
 *
 * Files already in /public/ (humans.txt, robots.txt, opensearch.xml) are
 * served by the static handler before this dynamic route runs, so this
 * route never shadows them. Any other unmatched `*.txt` request lands
 * here and returns 404 — preserving the normal "file not found"
 * behaviour for unrelated URLs.
 */
export const GET: APIRoute = ({ params }) => {
  const slug = String(params.indexnow_key ?? '');
  const configured = (
    import.meta.env.INDEXNOW_KEY ??
    process.env.INDEXNOW_KEY ??
    ''
  ).trim();

  // Empty configured key means IndexNow is disabled. Returning a generic
  // 404 here rather than 503 keeps the route indistinguishable from any
  // other missing static file — search engines just skip verification.
  if (!configured) {
    return new Response('Not Found', { status: 404 });
  }

  // The key is an ownership token (equivalent to a DNS TXT record), not a
  // secret. We still avoid leaking length information by length-checking
  // before the full equality test.
  if (slug.length !== configured.length || slug !== configured) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(configured, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
};

export const prerender = false;
