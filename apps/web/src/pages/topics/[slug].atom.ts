import type { APIRoute } from 'astro';
import { serverClient } from '../../lib/api';
import { publicWebBase } from '../../lib/public-base';

const PUBLIC_BASE = publicWebBase(import.meta.env.PUBLIC_WEB_BASE);

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ params, request }) => {
  const slug = params.slug;
  if (!slug) return new Response('Missing slug', { status: 400 });

  const client = serverClient(undefined, request);
  let dossier: Awaited<ReturnType<typeof client.topic>> | null = null;
  try {
    dossier = await client.topic(slug, 50);
  } catch {
    dossier = null;
  }
  if (!dossier) {
    return new Response('Topic unavailable', { status: 503 });
  }

  const updated = dossier.papers[0]?.publishedAt ?? new Date().toISOString();
  const feedUrl = `${PUBLIC_BASE}/topics/${encodeURIComponent(slug)}.atom`;
  const selfUrl = `${PUBLIC_BASE}/topics/${encodeURIComponent(slug)}`;

  const entries = dossier.papers
    .map((p) => {
      const url = `${PUBLIC_BASE}/abs/${p.openxivUrlId ?? p.paperId}`;
      const id = p.openxivId
        ? `urn:openxiv:${p.openxivId.replace(/^openxiv:/, '')}`
        : `${url}`;
      return `  <entry>
    <id>${esc(id)}</id>
    <title>${esc(p.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(url)}"/>
    <updated>${esc(p.publishedAt ?? new Date().toISOString())}</updated>
    <published>${esc(p.publishedAt ?? new Date().toISOString())}</published>
    <category term="${esc(p.primaryCategory)}"/>
    ${p.abstractFragment ? `<summary type="text">${esc(p.abstractFragment)}</summary>` : ''}
  </entry>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:openxiv:topic:${esc(slug)}</id>
  <title>OpenXiv — ${esc(dossier.label)}</title>
  <subtitle>Auto-aggregated dossier for ${esc(dossier.label)}.</subtitle>
  <link rel="self" href="${esc(feedUrl)}"/>
  <link rel="alternate" type="text/html" href="${esc(selfUrl)}"/>
  <updated>${esc(updated)}</updated>
  <author><name>OpenXiv</name></author>
${entries}
</feed>`;

  return new Response(body, {
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
};
