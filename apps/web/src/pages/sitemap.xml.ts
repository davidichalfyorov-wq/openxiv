import type { APIRoute } from 'astro';
import { CATEGORIES } from '@openxiv/shared';
import { serverClient } from '../lib/api';

export const prerender = false;

function publicBaseFromRequest(url: URL): string {
  const configured = import.meta.env.PUBLIC_WEB_BASE ?? process.env.PUBLIC_WEB_BASE;
  return (configured ?? url.origin).replace(/\/+$/, '');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ request, url }) => {
  const PUBLIC_BASE = publicBaseFromRequest(url);
  const client = serverClient(undefined, request);
  let urls: Array<{ loc: string; lastmod?: string; changefreq?: string; priority?: string }> = [
    { loc: `${PUBLIC_BASE}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${PUBLIC_BASE}/about`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${PUBLIC_BASE}/faq`, changefreq: 'monthly', priority: '0.7' },
    { loc: `${PUBLIC_BASE}/glossary`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${PUBLIC_BASE}/vocabulary`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${PUBLIC_BASE}/docs/how-to-submit`, changefreq: 'monthly', priority: '0.7' },
    { loc: `${PUBLIC_BASE}/press`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/stats`, changefreq: 'daily', priority: '0.7' },
    { loc: `${PUBLIC_BASE}/search`, changefreq: 'weekly', priority: '0.6' },
    { loc: `${PUBLIC_BASE}/transparency`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/privacy`, changefreq: 'yearly', priority: '0.3' },
    { loc: `${PUBLIC_BASE}/terms`, changefreq: 'yearly', priority: '0.3' },
    { loc: `${PUBLIC_BASE}/dmca`, changefreq: 'yearly', priority: '0.3' },
    // Policies index + sub-policies. Each one carries a citable claim
    // (CC-BY-4.0 default, refusal-packet workflow, geo-restriction
    // process) so an answer engine has a stable URL to point at.
    { loc: `${PUBLIC_BASE}/policies`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/code-of-conduct`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/submission`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/metadata`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/items`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/preservation`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/takedown`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/jurisdictional-restrictions`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${PUBLIC_BASE}/policies/dora-commitment`, changefreq: 'yearly', priority: '0.4' },
    // Comparison landing pages. The dynamic route renders one per slug.
    { loc: `${PUBLIC_BASE}/compare/arxiv`, changefreq: 'monthly', priority: '0.7' },
    { loc: `${PUBLIC_BASE}/compare/biorxiv`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${PUBLIC_BASE}/compare/ssrn`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${PUBLIC_BASE}/compare/researchsquare`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${PUBLIC_BASE}/compare/chemrxiv`, changefreq: 'monthly', priority: '0.6' },
  ];

  try {
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const { items } = await client.listPapers({ limit: pageSize, offset });
      for (const p of items) {
        const slug = p.openxivUrlId ?? p.id;
        const lastmod = (p.publishedAt ?? p.createdAt).slice(0, 10);
        urls.push({
          loc: `${PUBLIC_BASE}/p/${slug}`,
          lastmod,
          changefreq: 'monthly',
          priority: '0.9',
        });
        // Explainer SEO mirrors (P2 #15). Each tier is its own indexable URL
        // with canonical -> /p/{slug}, so search ranking consolidates onto
        // the paper page while the mirror's audience-specific wording
        // helps long-tail queries find it.
        for (const tier of ['school', 'undergrad', 'expert']) {
          urls.push({
            loc: `${PUBLIC_BASE}/abs/${slug}/explain/${tier}`,
            lastmod,
            changefreq: 'monthly',
            priority: '0.6',
          });
        }
      }
      if (items.length < pageSize) break;
    }
  } catch {
    // Sitemap should never 500 — just emit the static URLs.
  }

  // Topic dossiers — one URL per category. Keywords are too long-tail to
  // enumerate here; their dossiers get discovered via paper-page outlinks.
  for (const cat of CATEGORIES) {
    urls.push({
      loc: `${PUBLIC_BASE}/topics/${cat.code}`,
      changefreq: 'daily',
      priority: '0.7',
    });
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}${
      u.changefreq ? `\n    <changefreq>${u.changefreq}</changefreq>` : ''
    }${u.priority ? `\n    <priority>${u.priority}</priority>` : ''}
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
