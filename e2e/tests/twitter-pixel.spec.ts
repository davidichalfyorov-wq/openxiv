import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * Twitter Pixel end-to-end tests. Run against the BUILT web preview
 * (`pnpm -F @openxiv/web preview`), not the dev server — Vite's HMR
 * + transform-on-demand can produce subtly different bytes from what
 * ships to prod, and consent gating is bytes-sensitive (we want zero
 * `pxid=rch4y` in the HTML when the flag is off, etc.).
 *
 * Real network is the test surface here. We use `page.route` only to
 * *observe* requests, never to fulfil them — `route.continue()` keeps
 * the request flowing to Twitter's CDN. That way a regression where
 * we silently start preloading uwt.js shows up as an unexpected real
 * outbound request, not as a passing mock.
 *
 * Domain shape we watch:
 *
 *   - `static.ads-twitter.com/uwt.js`        — base script
 *   - `analytics.twitter.com/i/adsct?…`      — primary event endpoint
 *   - `t.co/i/adsct?…`                       — short-host event endpoint
 *   - `*.x.com/…`                            — newer X-branded surfaces
 *
 * Any request matching that shape qualifies as a "twitter request" in
 * the assertions below.
 */

const TWITTER_HOST_RE = /^(https?:\/\/)?(.*\.)?(ads-twitter\.com|analytics\.twitter\.com|t\.co|x\.com)\b/i;
const PIXEL_ID = 'rch4y';

interface CapturedRequest {
  url: string;
  method: string;
  resourceType: string;
}

function spy(page: Page): { requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  page.on('request', (req: Request) => {
    if (TWITTER_HOST_RE.test(req.url())) {
      requests.push({
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      });
    }
  });
  return { requests };
}

test.describe('Twitter Pixel — consent gating', () => {
  test('A. Fresh browser does not contact Twitter pre-consent', async ({ page }) => {
    const { requests } = spy(page);
    await page.goto('/');
    // Banner should be visible. Allow it to mount fully.
    await page.waitForSelector('#consent-banner', { state: 'visible', timeout: 5000 });
    // Nudge any deferred network — wait an extra beat.
    await page.waitForTimeout(500);
    expect(requests, `unexpected pre-consent network: ${requests.map((r) => r.url).join(', ')}`).toEqual([]);
  });

  test('B. Accept all triggers uwt.js load + PageView for pixel rch4y', async ({ page }) => {
    const { requests } = spy(page);
    await page.goto('/');
    await page.waitForSelector('#consent-banner', { state: 'visible', timeout: 5000 });
    // Accept all triggers location.reload() inside the banner script,
    // so we wait for that navigation to finish before sampling.
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.click('[data-consent-action="accept"]'),
    ]);
    // uwt.js + its first beacon. Twitter's network can be slow from
    // CI — give it 10s, then assert we saw at least the script load.
    await page.waitForTimeout(3000);
    const sawUwt = requests.some((r) => /uwt\.js/.test(r.url));
    expect(sawUwt, `did not see uwt.js: ${requests.map((r) => r.url).join(', ')}`).toBe(true);
    // The PageView fires as a query against analytics.twitter.com or
    // ads-twitter.com / t.co. Verify pixel id appears in some captured
    // URL.
    const sawPixelId = requests.some((r) => r.url.includes(PIXEL_ID));
    expect(sawPixelId, `pxid=${PIXEL_ID} not seen in any request`).toBe(true);
  });

  test('C. Reject leaves zero Twitter traffic after click', async ({ page }) => {
    const { requests } = spy(page);
    await page.goto('/');
    await page.waitForSelector('#consent-banner', { state: 'visible', timeout: 5000 });
    await page.click('[data-consent-action="reject"]');
    await page.waitForTimeout(2000);
    expect(requests, `unexpected post-reject traffic: ${requests.map((r) => r.url).join(', ')}`).toEqual([]);
  });

  test('D. DNT=1 context never renders the banner and emits no requests', async ({ browser }) => {
    const ctx = await browser.newContext({
      // Playwright honours the platform's DNT API — we set it here via
      // the standard request header AND via a script that monkey-patches
      // navigator.doNotTrack. The banner script accepts either.
      extraHTTPHeaders: { DNT: '1' },
      javaScriptEnabled: true,
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => '1' });
    });
    const page = await ctx.newPage();
    const { requests } = spy(page);
    await page.goto('/');
    await page.waitForTimeout(800);
    // Banner must not be visible.
    const banner = await page.$('#consent-banner');
    if (banner) {
      const visible = await banner.isVisible();
      expect(visible, 'banner rendered despite DNT=1').toBe(false);
    }
    expect(requests, `DNT=1 leaked Twitter traffic: ${requests.map((r) => r.url).join(', ')}`).toEqual([]);
    await ctx.close();
  });

  test('E. window.openxivTwitter exposes event() helper post-Accept', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#consent-banner', { state: 'visible', timeout: 5000 });
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.click('[data-consent-action="accept"]'),
    ]);
    await page.waitForTimeout(500);
    const helperShape = await page.evaluate(() => {
      const w = window as unknown as { openxivTwitter?: { event?: unknown; pixelId?: string } };
      return {
        hasHelper: typeof w.openxivTwitter?.event === 'function',
        pixelId: w.openxivTwitter?.pixelId ?? null,
      };
    });
    expect(helperShape.hasHelper).toBe(true);
    expect(helperShape.pixelId).toBe(PIXEL_ID);
  });

  test('F. Calling event() post-Accept produces a Twitter request', async ({ page }) => {
    const { requests } = spy(page);
    await page.goto('/');
    await page.waitForSelector('#consent-banner', { state: 'visible', timeout: 5000 });
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.click('[data-consent-action="accept"]'),
    ]);
    await page.waitForTimeout(3000);
    const before = requests.length;
    // Fire a synthetic event from the test runner.
    await page.evaluate(() => {
      const w = window as unknown as { openxivTwitter?: { event(id: string, p: Record<string, unknown>): void } };
      w.openxivTwitter?.event('tw-rch4y-rch5b', {
        conversion_id: '00000000-0000-0000-0000-000000000001',
      });
    });
    await page.waitForTimeout(2000);
    const after = requests.length;
    expect(after, `event() did not fire any Twitter request (before=${before}, after=${after})`).toBeGreaterThan(before);
  });

  test('G. Flag-off renders zero pixel script tag', async ({ page, baseURL }) => {
    // Reading the raw HTML directly rather than via the rendered page —
    // this asserts the server-render gate, not just client visibility.
    test.skip(
      !process.env['E2E_FLAG_OFF_BASE_URL'],
      'set E2E_FLAG_OFF_BASE_URL to a preview built with PUBLIC_TWITTER_TRACKING_ENABLED=false to run',
    );
    const flagOffUrl = process.env['E2E_FLAG_OFF_BASE_URL'] ?? baseURL ?? 'http://localhost:4321';
    const res = await page.request.get(flagOffUrl);
    const body = await res.text();
    expect(body).not.toContain('uwt.js');
    expect(body).not.toContain(`pxid=${PIXEL_ID}`);
    expect(body).not.toContain('openxivTwitter');
  });
});
