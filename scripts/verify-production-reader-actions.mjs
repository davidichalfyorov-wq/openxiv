import { createRequire } from 'node:module';

const require = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const baseUrl = (process.env.OPENXIV_BASE_URL ?? 'https://openxiv.net').replace(/\/+$/, '');

const targets = [
  `${baseUrl}/abs/openxiv:math-ph.2026.00001`,
  `${baseUrl}/abs/openxiv:gr-qc.2026.00001`,
  `${baseUrl}/abs/math-ph.2026.00001/read`,
  `${baseUrl}/abs/gr-qc.2026.00001/read`,
];

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

const failures = [];
const results = [];

for (const url of targets) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  const metrics = await page.evaluate(() => {
    const sticky = Array.from(document.querySelectorAll('body *'))
      .filter((el) => getComputedStyle(el).position === 'sticky')
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === 'string' ? el.className : '',
      }));
    const figureButtons = Array.from(document.querySelectorAll('button.figure-thumb'));
    const labelledFigures = figureButtons.filter((button) => {
      const caption = button.getAttribute('data-figure-caption') ?? '';
      const label = button.getAttribute('aria-label') ?? '';
      return caption.length === 0 || label.includes(caption);
    }).length;
    const mobileStylesheetHrefs = Array.from(
      document.querySelectorAll('link[media="(max-width: 768px)"]'),
    )
      .filter((link) => {
        const rel = link.getAttribute('rel') ?? '';
        return rel === 'preload' || rel === 'stylesheet';
      })
      .map((link) => link.getAttribute('href'));

    return {
      title: document.title,
      notFound: document.body.innerText.includes('Paper not found'),
      onlyHeaderSticky:
        sticky.length === 1 && sticky[0]?.tag === 'header' && sticky[0]?.className.includes('header-bar'),
      sticky,
      trustRoleCount: document.querySelectorAll(
        '.trust-lanes[role="list"], .trust-lane[role="listitem"]',
      ).length,
      abstractH3Count: document.querySelectorAll('h3.ltx_title_abstract').length,
      abstractH2Count: document.querySelectorAll('h2.ltx_title_abstract').length,
      redundantFigureAltCount: document.querySelectorAll('button.figure-thumb img:not([alt=""])')
        .length,
      figureButtonCount: figureButtons.length,
      labelledFigures,
      mobileStylesheetHrefs,
      referencesAccordionCount: document.querySelectorAll('.paper-references-accordion').length,
      citationLinkCount: document.querySelectorAll('[data-bib-ref]').length,
      backlinkCount: document.querySelectorAll('.paper-ref-backlink, .paper-ref-backlink-chip')
        .length,
      explainerTabRects: Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => {
        const rect = tab.getBoundingClientRect();
        return { width: rect.width, height: rect.height, text: tab.textContent?.trim() };
      }),
    };
  });

  if (metrics.notFound) failures.push(`${url}: Paper not found`);
  if (!metrics.onlyHeaderSticky) failures.push(`${url}: sticky elements ${JSON.stringify(metrics.sticky)}`);
  if (metrics.trustRoleCount !== 0) failures.push(`${url}: incompatible trust ARIA roles`);
  if (metrics.abstractH3Count !== 0) failures.push(`${url}: abstract is still h3`);
  if (url.includes('/abs/openxiv:') && metrics.abstractH2Count < 1) {
    failures.push(`${url}: abstract h2 missing`);
  }
  if (metrics.redundantFigureAltCount !== 0) failures.push(`${url}: non-decorative thumbnail alt`);
  if (metrics.figureButtonCount !== metrics.labelledFigures) {
    failures.push(`${url}: figure button labels do not include visible captions`);
  }
  if (metrics.mobileStylesheetHrefs.length < 2) {
    failures.push(`${url}: mobile stylesheet preload/onload links missing`);
  }
  if (metrics.referencesAccordionCount < 1) failures.push(`${url}: references accordion missing`);
  if (metrics.citationLinkCount < 1) failures.push(`${url}: citation backlinks not instrumented`);
  if (metrics.backlinkCount < 1) failures.push(`${url}: compact backlinks missing`);
  for (const rect of metrics.explainerTabRects) {
    if (rect.height < 44) failures.push(`${url}: explainer tab ${rect.text} height ${rect.height}`);
  }

  const galleryButton = page.locator('button.figure-thumb').first();
  if ((await galleryButton.count()) > 0) {
    await galleryButton.scrollIntoViewIfNeeded();
    await galleryButton.click();
    const openGallery = await page.locator('dialog[open]#figures-lightbox').count();
    if (openGallery < 1) failures.push(`${url}: figure gallery dialog did not open`);
    await page.keyboard.press('Escape');
  }

  const inlineFigure = page
    .locator('.reader-body figure img, .reader-body figure svg, .paper-inline-html figure img, .paper-inline-html figure svg')
    .first();
  if ((await inlineFigure.count()) > 0) {
    await inlineFigure.scrollIntoViewIfNeeded();
    await inlineFigure.click();
    const openInline = await page.locator('dialog[open].paper-figure-zoom-dialog').count();
    if (openInline < 1) failures.push(`${url}: inline figure zoom dialog did not open`);
    await page.keyboard.press('Escape');
  }

  const firstCitation = page.locator('[data-bib-ref]').first();
  if ((await firstCitation.count()) > 0) {
    await firstCitation.hover();
    const highlighted = await page.locator('.paper-citation-target-highlight').count();
    if (highlighted < 1) failures.push(`${url}: citation target did not highlight`);
  }

  results.push(metrics);
  await context.close();
}

await browser.close();

console.log(JSON.stringify({ failures, results }, null, 2));
if (failures.length > 0) process.exit(1);
