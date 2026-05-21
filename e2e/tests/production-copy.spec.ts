import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Production copy gate (P1 #1).
 *
 * Scans the SSR HTML of every routable surface for dev-language leaks. If a
 * banned substring appears in *visible* text, the test fails — a TODO that
 * landed in production is exactly the kind of regression this catches at
 * PR time.
 *
 * Rules:
 *   - `placeholder="…"` attributes are exempt (they're the HTML attribute,
 *     not the dev-text-leak sense).
 *   - HTML comments are exempt; their content isn't displayed.
 *   - <script>, <style> blocks are stripped before scanning — the banned
 *     words are fine in code, just not in user-visible prose.
 *   - We match whole words case-insensitively so "OpenXiv" doesn't trigger
 *     on "open" or similar incidental matches.
 */
const BANNED = ['mock', 'wired', 'TODO', 'stub', 'dev only', 'FIXME', 'XXX', 'coming soon', 'TBD'] as const;

/**
 * Routes to scan. We pick one representative per template family rather
 * than the full corpus — scanning every paper is overkill for a copy gate
 * (and would be tied to a specific fixture).
 */
const ROUTES = [
  '/',
  '/about',
  '/stats',
  '/search',
  '/search?q=physics',
  '/topics/cs.AI',
  '/prereg/new',
  '/privacy',
  '/terms',
  '/dmca',
];

async function findFirstAbsSlug(request: APIRequestContext): Promise<string | null> {
  const res = await request.get('/api-proxy/papers?limit=20');
  if (!res.ok()) return null;
  const data = (await res.json()) as { items: Array<{ openxivUrlId: string | null }> };
  const hit = data.items.find((p) => p.openxivUrlId);
  return hit?.openxivUrlId ?? null;
}

function stripUninteresting(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/placeholder="[^"]*"/gi, ' ')
    .replace(/aria-[a-z-]+="[^"]*"/gi, ' ');
}

function findBanned(html: string): { word: string; context: string } | null {
  const clean = stripUninteresting(html);
  for (const word of BANNED) {
    const re = new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'i');
    const m = re.exec(clean);
    if (m && m.index !== undefined) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(clean.length, m.index + m[0].length + 60);
      return { word, context: clean.slice(start, end).replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}

test.describe('Production copy gate — no dev-language in public SSR', () => {
  for (const route of ROUTES) {
    test(`route ${route} has no dev-language leaks`, async ({ request }) => {
      const res = await request.get(route);
      if (res.status() === 404) {
        // 404 pages are OK to skip — they're a different copy template,
        // not the route under test.
        return;
      }
      expect(res.status(), `route ${route} should respond 200 or 3xx`).toBeLessThan(400);
      const html = await res.text();
      const hit = findBanned(html);
      expect(
        hit,
        hit
          ? `route ${route} leaked dev-language ("${hit.word}"). Context: …${hit.context}…`
          : 'no leak',
      ).toBeNull();
    });
  }

  test('dynamic /abs/{id} surfaces also clean', async ({ request }) => {
    const slug = await findFirstAbsSlug(request);
    test.skip(!slug, 'no published paper available to scan');
    for (const variant of [
      `/abs/${slug}`,
      `/abs/${slug}/read`,
      `/abs/${slug}/priority`,
      `/abs/${slug}/explain/school`,
    ]) {
      const res = await request.get(variant);
      if (!res.ok()) continue;
      const html = await res.text();
      const hit = findBanned(html);
      expect(
        hit,
        hit
          ? `variant ${variant} leaked dev-language ("${hit.word}"). Context: …${hit.context}…`
          : 'no leak',
      ).toBeNull();
    }
  });
});
