import type { APIRoute } from 'astro';
import { serverClient } from '../lib/api';
import { publicWebBase } from '../lib/public-base';

export const prerender = false;

const PUBLIC_BASE = publicWebBase(import.meta.env.PUBLIC_WEB_BASE);
const FEED_TITLE = 'OpenXiv — latest papers';
const FEED_SUBTITLE = 'Science social + preprint server on the AT Protocol.';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ request }) => {
  const client = serverClient(undefined, request);
  let items: Array<{
    id: string;
    title: string;
    publishedAt: string;
    submitterDid: string;
    openxivUrlId: string | null;
    openxivId: string | null;
  }> = [];
  try {
    const res = await client.listPapers({ limit: 50 });
    items = res.items.map((p) => ({
      id: p.id,
      title: p.title,
      publishedAt: (p.publishedAt ?? p.createdAt),
      submitterDid: p.submitterDid,
      openxivUrlId: p.openxivUrlId,
      openxivId: p.openxivId,
    }));
  } catch {
    // empty feed is still valid
  }

  const updated = items[0]?.publishedAt ?? new Date().toISOString();

  const entries = items
    .map((p) => {
      const slug = p.openxivUrlId ?? p.id;
      const url = `${PUBLIC_BASE}/abs/${slug}`;
      const id = p.openxivId
        ? `urn:openxiv:${p.openxivId.replace(/^openxiv:/, '')}`
        : `urn:openxiv:paper:${p.id}`;
      return `  <entry>
    <id>${esc(id)}</id>
    <title>${esc(p.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(url)}" />
    <updated>${p.publishedAt}</updated>
    <published>${p.publishedAt}</published>
    <author><name>${esc(p.submitterDid)}</name></author>
  </entry>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(PUBLIC_BASE)}/feed.atom</id>
  <title>${esc(FEED_TITLE)}</title>
  <subtitle>${esc(FEED_SUBTITLE)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${esc(PUBLIC_BASE)}/feed.atom" />
  <link rel="alternate" type="text/html" href="${esc(PUBLIC_BASE)}/" />
  <updated>${updated}</updated>
  <generator uri="${esc(PUBLIC_BASE)}">OpenXiv</generator>
${entries}
</feed>`;

  return new Response(body, {
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
};
