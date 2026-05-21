import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('KaTeX rendering surfaces', () => {
  it('loads KaTeX on every preprint surface that renders paper text', () => {
    const paper = readFileSync(new URL('../src/pages/paper/[id].astro', import.meta.url), 'utf8');
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const p = readFileSync(new URL('../src/pages/p/[...id].astro', import.meta.url), 'utf8');
    const explainer = readFileSync(
      new URL('../src/pages/abs/[id]/explain/[tier].astro', import.meta.url),
      'utf8',
    );
    const reader = readFileSync(
      new URL('../src/pages/abs/[id]/read.astro', import.meta.url),
      'utf8',
    );
    const head = readFileSync(
      new URL('../src/components/KaTeXHead.astro', import.meta.url),
      'utf8',
    );

    expect(paper).toContain('KaTeXHead');
    expect(abs).toContain('KaTeXHead');
    expect(p).toContain('KaTeXHead');
    expect(explainer).toContain('KaTeXHead');
    expect(reader).toContain('KaTeXHead');
    expect(head).toContain('cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js');
    expect(head).toContain('rel="preload"');
    expect(head).toContain('as="style"');
    expect(head).toContain('media="(max-width: 768px)"');
    expect(head).toContain('this.rel=');
    expect(head).toContain('window.openxivRenderMath');
    expect(head).toContain('openxivInstallPaperBehaviors');
    expect(head).toContain('paper-citation-target-highlight');
    expect(head).toContain('paper-figure-zoom-dialog');
    expect(head).toContain("output: 'html'");
    expect(head).toContain('isZoomableFigureMedia');
    expect(head).toContain("closest('.katex, .paper-math, math, figcaption, table')");
    expect(head).toContain('notranslate');
    expect(head).toContain('protectRenderedMath');
    expect(head).toContain("math.closest('svg')");
  });

  it('re-renders explainer math when the selected tier changes', () => {
    const source = readFileSync(
      new URL('../src/components/Explainer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('openxivRenderMath');
    expect(source).toContain('explainerRef');
    expect(source).toContain('[current?.text, tier]');
  });

  it('keeps explainer tabs large enough for mobile touch targets', () => {
    const source = readFileSync(
      new URL('../src/components/Explainer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('role="tablist"');
    expect(source).toContain('minHeight: 44');
    expect(source).toContain('minWidth: 72');
    expect(source).toContain('flexWrap:');
  });

  it('allows the KaTeX CDN in production CSP', () => {
    const caddy = readFileSync(new URL('../../../Caddyfile.production', import.meta.url), 'utf8');

    expect(caddy).toContain("script-src 'self' 'unsafe-inline'");
    expect(caddy).toContain(
      "script-src 'self' 'unsafe-inline' https://static.ads-twitter.com https://cdn.jsdelivr.net",
    );
    expect(caddy).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    );
    expect(caddy).toContain("font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net");
  });

  it('keeps review cards in a non-sticky wide rail and moves artifact/export panels to the footer band', () => {
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const sideStart = abs.indexOf('<aside class="paper-reader-side stack"');
    const sideEnd = abs.indexOf('</aside>', sideStart);
    const sidePanel = sideStart >= 0 && sideEnd > sideStart ? abs.slice(sideStart, sideEnd) : '';
    const footerStart = abs.indexOf('<section class="paper-footer-actions"');
    const footerBand = footerStart >= 0 ? abs.slice(footerStart, footerStart + 4_000) : '';

    expect(sidePanel).toContain(
      'AIUsageCard paper={paper} absUrl={publicPaperUrl} variant="compact"',
    );
    expect(sidePanel).toContain('<Explainer client:visible paperId={paper.id}');
    expect(sidePanel).toContain('TrustPanel');
    expect(sidePanel).toContain('EndorsementsPanel');
    expect(sidePanel.indexOf('<Explainer client:visible paperId={paper.id}')).toBeLessThan(
      sidePanel.indexOf('AIUsageCard paper={paper} absUrl={publicPaperUrl} variant="compact"'),
    );
    expect(sidePanel.indexOf('<Explainer client:visible paperId={paper.id}')).toBeLessThan(
      sidePanel.indexOf('TrustPanel'),
    );
    expect(sidePanel).not.toContain('Article artifacts');
    expect(sidePanel).not.toContain('Raw HTML');
    expect(abs).not.toContain(
      '<section class="stack">\n              <Explainer client:visible paperId={paper.id}',
    );
    expect(abs).toContain('<main class="container paper-page">');
    expect(abs).toContain('max-width: min(1440px, calc(100vw - 40px))');
    expect(abs).toContain('minmax(460px, 520px)');
    expect(abs).toContain('@media (max-width: 1180px)');
    expect(abs).toContain('position: static');
    expect(abs).not.toContain('position: sticky');
    expect(abs).not.toContain('--paper-sticky-top');
    expect(abs).not.toContain('max-height: min(760px');
    expect(abs).toContain('.paper-inline-html math');
    expect(abs).toContain('contain: paint');
    expect(abs).toContain('.paper-inline-html .ltx_eqn_cell');
    expect(abs).toContain('overflow-x: clip');
    expect(abs).toContain('overflow-x: hidden');
    expect(abs).toContain('body {');
    expect(abs).toContain('width: 100%');

    expect(footerBand).toContain('Article artifacts');
    expect(footerBand).toContain(
      'AIUsageCard paper={paper} absUrl={publicPaperUrl} variant="full"',
    );
    expect(footerBand).toContain('Raw HTML');
  });

  it('keeps mobile paper reading touch-safe without adding sticky panels', () => {
    const base = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
    const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const reader = readFileSync(
      new URL('../src/pages/abs/[id]/read.astro', import.meta.url),
      'utf8',
    );

    expect(base).toContain('viewport-fit=cover');
    expect(globalCss).toContain('-webkit-text-size-adjust: 100%');
    expect(abs).toContain('@media (max-width: 768px)');
    expect(reader).toContain('@media (max-width: 768px)');
    expect(abs).toContain('env(safe-area-inset-left)');
    expect(reader).toContain('env(safe-area-inset-left)');
    expect(abs).toContain('min-height: 44px');
    expect(reader).toContain('min-height: 44px');
    expect(abs).toContain('content-visibility: auto');
    expect(abs).toContain('contain-intrinsic-size');
    expect(abs).toContain('contain-intrinsic-size: 0 900px');
    expect(abs).toContain('paper-ref-backlink-chip');
    expect(reader).toContain('paper-ref-backlink-chip');
    expect(abs).toContain('.paper-inline-html .paper-references-accordion');
    expect(reader).toContain('.reader-body .paper-references-accordion');
    expect(abs).toContain('.paper-inline-html .paper-citation-target-highlight');
    expect(reader).toContain('.reader-body .paper-citation-target-highlight');
    expect(abs).toContain('.paper-inline-html .paper-figure-zoom-dialog');
    expect(reader).toContain('.reader-body .paper-figure-zoom-dialog');
    expect(abs).toContain('.paper-inline-html .ltx_title_paragraph');
    expect(reader).toContain('.reader-body .ltx_title_paragraph');
    expect(abs).toContain('section:has(.paper-references-accordion)');
    expect(reader).toContain('section:has(.paper-references-accordion)');
    expect(abs).toContain('openxiv-scrollbarless');
    expect(reader).toContain('openxiv-scrollbarless');
    expect(reader).toContain('content-visibility: auto');
    expect(reader).toContain('contain-intrinsic-size');
    expect(reader).toContain('contain-intrinsic-size: 0 900px');
    expect(reader).not.toContain('position: sticky');
  });

  it('does not paint-contain nested math renderer boxes', () => {
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const reader = readFileSync(
      new URL('../src/pages/abs/[id]/read.astro', import.meta.url),
      'utf8',
    );

    for (const source of [abs, reader]) {
      expect(source).not.toContain('.katex *');
      expect(source).not.toContain('.paper-math *');
      expect(source).not.toContain('math *');
      const containPaintSelectors = Array.from(
        source.matchAll(/([^{}]+)\{\s*contain:\s*paint;/g),
        (match) => match[1] ?? '',
      );
      for (const selector of containPaintSelectors) {
        expect(selector).not.toContain('.katex-display');
        expect(selector).not.toContain('svg');
      }
    }
  });

  it('hides inline broken figure placeholders and avoids visible nested math scrollbars', () => {
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const reader = readFileSync(
      new URL('../src/pages/abs/[id]/read.astro', import.meta.url),
      'utf8',
    );

    for (const source of [abs, reader]) {
      expect(source).toContain('.ltx_missing_image[data-openxiv-missing-figure="1"]');
      expect(source).toContain('display: none');
      expect(source).toContain('svg.ltx_picture');
      expect(source).toContain('font-size: 8px');
      expect(source).toContain('openxiv-scrollbarless');
      expect(source).toContain('scrollbar-width: none');
      expect(source).toMatch(/\.(paper-inline-html|reader-body) \*::?-?webkit-scrollbar|\.paper-inline-html \*::-webkit-scrollbar|\.reader-body \*::-webkit-scrollbar/);
      expect(source).not.toContain('overflow-x: auto;\\n    overflow-y: hidden;\\n    vertical-align: middle;');
    }
  });

  it('uses PDF-extracted crops to replace LaTeXML TikZ SVG figures', () => {
    const abs = readFileSync(new URL('../src/pages/abs/[...id].astro', import.meta.url), 'utf8');
    const reader = readFileSync(
      new URL('../src/pages/abs/[id]/read.astro', import.meta.url),
      'utf8',
    );

    expect(abs).toContain("figureExtraction.source === 'pdf_grobid'");
    expect(abs).toContain('replaceSvgFigures:');
    expect(reader).toContain('let replaceSvgFigures = false');
    expect(reader).toContain("r.extraction.source === 'pdf_grobid'");
    expect(reader).toContain('postProcessPaperHtml(raw, { figureImageUrls, replaceSvgFigures })');
  });
});
