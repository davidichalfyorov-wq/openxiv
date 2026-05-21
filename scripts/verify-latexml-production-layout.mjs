import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const baseUrl = (process.env.OPENXIV_BASE_URL ?? 'https://openxiv.net').replace(/\/+$/, '');
const outDir = path.resolve(process.env.OPENXIV_LAYOUT_OUT ?? 'output/latexml-fix-2026-05-20');
const screenshotSet = new Set([
  'math-ph-abs-light-320',
  'math-ph-abs-light-1920',
  'gr-qc-abs-light-3840',
  'math-ph-abs-dark-375',
  'gr-qc-abs-light-1440',
  'gr-qc-abs-dark-375',
  'gr-qc-read-light-1920',
  'math-ph-read-dark-375',
]);

const targets = [
  { name: 'math-ph-abs', url: `${baseUrl}/abs/openxiv:math-ph.2026.00001`, hasSideRail: true },
  { name: 'gr-qc-abs', url: `${baseUrl}/abs/openxiv:gr-qc.2026.00001`, hasSideRail: true },
  { name: 'math-ph-read', url: `${baseUrl}/abs/math-ph.2026.00001/read`, hasSideRail: false },
  { name: 'gr-qc-read', url: `${baseUrl}/abs/gr-qc.2026.00001/read`, hasSideRail: false },
];

const viewports = [
  { width: 320, height: 720 },
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1180, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 1600 },
];

const themeFor = (targetName, width) => {
  if (targetName.endsWith('-read')) return width === 375 ? ['dark'] : ['light'];
  if (width === 375) return ['light', 'dark'];
  if (width === 1920) return ['light'];
  return ['light'];
};

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

const results = [];
const failures = [];

for (const target of targets) {
  for (const viewport of viewports) {
    for (const colorScheme of themeFor(target.name, viewport.width)) {
      const context = await browser.newContext({ viewport, colorScheme });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      await page.goto(target.url, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.evaluate(() => {
        const anchor =
          document.querySelector('.paper-reader-shell') ??
          document.querySelector('.reader-body') ??
          document.querySelector('main');
        const top = anchor ? anchor.getBoundingClientRect().top + window.scrollY : 0;
        window.scrollTo(0, Math.max(0, top + 180));
      });
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        const overflowContainerSelector = [
          'math',
          'svg',
          'figure',
          'pre',
          'table',
          '.katex',
          '.katex-display',
          '.paper-math',
          '.paper-math-display',
          '.ltx_equation',
          '.ltx_eqn_cell',
          '.paper-table-wrap',
        ].join(',');
        const rect = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            top: Number(r.top.toFixed(2)),
            bottom: Number(r.bottom.toFixed(2)),
            width: Number(r.width.toFixed(2)),
            height: Number(r.height.toFixed(2)),
          };
        };
        const side = document.querySelector('.paper-reader-side');
        const sideStyle = side ? getComputedStyle(side) : null;
        const root = document.documentElement;
        const beforeY = window.scrollY;
        window.scrollTo(10_000, beforeY);
        const canScrollX = window.scrollX;
        window.scrollTo(0, beforeY);
        const overflowing = Array.from(document.querySelectorAll('body *'))
          .filter((el) => !el.closest(overflowContainerSelector))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              id: el.id,
              className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
              left: Number(r.left.toFixed(2)),
              right: Number(r.right.toFixed(2)),
              width: Number(r.width.toFixed(2)),
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
            };
          })
          .filter((x) => x.className !== 'skip-link')
          .filter((x) => x.width > 1 && (x.left < -1 || x.right > root.clientWidth + 1))
          .slice(0, 12);
        const failedMath = document.querySelectorAll('math[data-openxiv-katex="failed"]').length;
        const rawLatexmlMath = Array.from(document.querySelectorAll('math')).filter(
          (math) =>
            !math.closest('.katex-mathml') &&
            math.getAttribute('data-openxiv-katex') !== 'failed' &&
            Boolean(
              math.querySelector(
                'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]',
              ),
            ),
        ).length;
        const redFallback = Array.from(document.querySelectorAll('body *'))
          .filter((el) => {
            if (el.closest('.error')) return false;
            const style = getComputedStyle(el);
            return (
              style.color === 'rgb(255, 0, 0)' ||
              style.color === 'red' ||
              style.borderColor === 'rgb(255, 0, 0)'
            );
          })
          .slice(0, 8)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
          }));

        return {
          notFound: document.body.innerText.includes('Paper not found'),
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          bodyOverflow: root.scrollWidth - root.clientWidth,
          canScrollX,
          katexErrors: document.querySelectorAll('.katex-error').length,
          failedMath,
          rawLatexmlMath,
          redFallback,
          sidePosition: sideStyle?.position ?? null,
          sideOverflowY: sideStyle?.overflowY ?? null,
          sideMaxHeight: sideStyle?.maxHeight ?? null,
          trust: rect('.trust-panel'),
          side: rect('.paper-reader-side'),
          aiCompact: rect('#ai-usage-compact'),
          aiFull: rect('#ai-usage'),
          artifacts: rect('.artifact-card'),
          hasTrustInSide: Boolean(side?.contains(document.querySelector('.trust-panel'))),
          hasCompactAiInSide: Boolean(side?.contains(document.querySelector('#ai-usage-compact'))),
          hasFullAiInFooter: Boolean(
            document.querySelector('#ai-usage') &&
            !side?.contains(document.querySelector('#ai-usage')),
          ),
          hasArtifactsInFooter: Boolean(
            document.querySelector('.artifact-card') &&
            !side?.contains(document.querySelector('.artifact-card')),
          ),
          overflowing,
        };
      });

      const key = `${target.name}-${colorScheme}-${viewport.width}`;
      let screenshot = null;
      if (screenshotSet.has(key)) {
        screenshot = `${key}.png`;
        await page.screenshot({ path: path.join(outDir, screenshot), fullPage: false });
      }

      const result = {
        page: target.name,
        url: target.url,
        width: viewport.width,
        height: viewport.height,
        colorScheme,
        screenshot,
        consoleErrors: consoleErrors.slice(0, 10),
        ...metrics,
      };
      results.push(result);

      if (result.notFound) failures.push(`${key}: rendered Paper not found`);
      if (result.katexErrors !== 0) failures.push(`${key}: ${result.katexErrors} KaTeX errors`);
      if (result.failedMath !== 0)
        failures.push(`${key}: ${result.failedMath} failed LaTeXML math nodes`);
      if (result.rawLatexmlMath !== 0)
        failures.push(`${key}: ${result.rawLatexmlMath} raw LaTeXML math nodes`);
      if (result.redFallback.length > 0) {
        failures.push(`${key}: red fallback boxes ${JSON.stringify(result.redFallback)}`);
      }
      if (result.canScrollX > 1) {
        failures.push(`${key}: horizontal page scroll ${result.canScrollX}px`);
      }
      if (result.overflowing.length > 0) {
        failures.push(`${key}: overflowing elements ${JSON.stringify(result.overflowing)}`);
      }
      if (target.hasSideRail) {
        if (result.sidePosition !== 'static')
          failures.push(`${key}: side rail is ${result.sidePosition}`);
        if (result.sideMaxHeight !== 'none')
          failures.push(`${key}: side rail max-height ${result.sideMaxHeight}`);
        if (result.sideOverflowY !== 'visible')
          failures.push(`${key}: side rail overflow-y ${result.sideOverflowY}`);
        if (!result.hasTrustInSide) failures.push(`${key}: Trust Passport missing from side rail`);
        if (!result.hasCompactAiInSide)
          failures.push(`${key}: compact AI Usage missing from side rail`);
        if (!result.hasFullAiInFooter) failures.push(`${key}: full AI Usage missing from footer`);
        if (!result.hasArtifactsInFooter)
          failures.push(`${key}: Article artifacts missing from footer`);
        if (result.trust && result.width >= 1180 && result.trust.width < 440) {
          failures.push(`${key}: Trust Passport too narrow at ${result.trust.width}px`);
        }
        if (result.trust && result.width < 1180 && result.trust.width < result.clientWidth - 100) {
          failures.push(
            `${key}: Trust Passport not expanded on compact viewport (${result.trust.width}px)`,
          );
        }
      }
      const unexpectedConsoleErrors = result.consoleErrors.filter(
        (message) => !message.includes('React error #418'),
      );
      if (unexpectedConsoleErrors.length > 0) {
        failures.push(`${key}: console errors ${unexpectedConsoleErrors.join(' | ')}`);
      }

      await context.close();
    }
  }
}

await browser.close();
await writeFile(path.join(outDir, 'viewport-metrics.json'), JSON.stringify(results, null, 2));

console.log(
  JSON.stringify(
    {
      failures,
      checked: results.length,
      summary: results.map((result) => ({
        page: result.page,
        width: result.width,
        colorScheme: result.colorScheme,
        notFound: result.notFound,
        overflow: result.bodyOverflow,
        canScrollX: result.canScrollX,
        katexErrors: result.katexErrors,
        failedMath: result.failedMath,
        rawLatexmlMath: result.rawLatexmlMath,
        sidePosition: result.sidePosition,
        trustWidth: result.trust?.width ?? null,
        screenshot: result.screenshot,
      })),
    },
    null,
    2,
  ),
);

process.exitCode = failures.length === 0 ? 0 : 1;
