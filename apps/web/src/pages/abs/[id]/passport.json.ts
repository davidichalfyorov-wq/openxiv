import type { APIRoute } from 'astro';
import { serverClient } from '../../../lib/api';

export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return new Response('Missing id', { status: 400 });
  const cookie = request.headers.get('cookie') ?? undefined;
  const client = serverClient(cookie, request);

  try {
    const passport = await client.getPaperPassport(id);
    return new Response(JSON.stringify(passport, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/ld+json; charset=utf-8',
        'cache-control': 'public, max-age=60, s-maxage=300',
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
};
