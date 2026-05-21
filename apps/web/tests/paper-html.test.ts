import { describe, expect, it } from 'vitest';
import { postProcessPaperHtml } from '../src/lib/paper-html';

describe('paper HTML post-processing', () => {
  it('extracts the body and adds stable section and paragraph anchors', () => {
    const html = `
      <html>
        <head><title>x</title></head>
        <body>
          <section><h2>Intro</h2><p>First paragraph.</p><p>Second paragraph.</p></section>
          <section id="methods"><p>Method paragraph.</p></section>
        </body>
      </html>
    `;

    const processed = postProcessPaperHtml(html);

    expect(processed).not.toContain('<body>');
    expect(processed).toContain('<section id="sec-1">');
    expect(processed).toContain('<section id="methods">');
    expect(processed).toContain('<p id="sec-1-p1">First paragraph.</p>');
    expect(processed).toContain('<p id="sec-1-p2">Second paragraph.</p>');
    expect(processed).toContain('<p id="sec-2-p1">Method paragraph.</p>');
  });

  it('marks bibliography links for reader hovercards', () => {
    const processed = postProcessPaperHtml('<p><a href="#bibAnselmi2018">[1]</a></p>');

    expect(processed).toContain('data-bib-ref="bibAnselmi2018"');
  });

  it('hydrates LaTeXML missing figure placeholders from extracted figure URLs', () => {
    const processed = postProcessPaperHtml(
      `
        <figure id="S1.F1" class="ltx_figure">
          <img src="" class="ltx_graphics ltx_missing ltx_missing_image" alt="Refer to caption">
          <figcaption>Figure 1: A real figure caption.</figcaption>
        </figure>
      `,
      { figureImageUrls: ['https://openxiv.net/openxiv-blobs/papers/p1/v1-source-fig-0.png'] },
    );

    expect(processed).toContain(
      'src="https://openxiv.net/openxiv-blobs/papers/p1/v1-source-fig-0.png"',
    );
    expect(processed).toContain('alt=""');
    expect(processed).not.toContain('ltx_missing_image');
    expect(processed).not.toContain('Refer to caption');
  });

  it('hides unhydrated LaTeXML figure placeholders instead of rendering broken image text', () => {
    const processed = postProcessPaperHtml(
      `
        <figure id="S1.F1" class="ltx_figure">
          <img src="" class="ltx_graphics ltx_missing ltx_missing_image" alt="Refer to caption">
          <figcaption>Figure 1: Caption only.</figcaption>
        </figure>
      `,
    );

    expect(processed).toContain('data-openxiv-missing-figure="1"');
    expect(processed).toContain('alt=""');
    expect(processed).not.toContain('Refer to caption');
  });

  it('removes LaTeXML TikZ unit artifacts from inline SVG figures', () => {
    const processed = postProcessPaperHtml(`
      <body>
        <figure class="ltx_figure">
          <svg class="ltx_picture">
            <g class="ltx_tikzmatrix_col"><text transform="matrix(1 0 0 -1 0 0)">pt</text></g>
            <g class="ltx_tikzmatrix_col"><text>No-section theorem</text></g>
          </svg>
        </figure>
      </body>
    `);

    expect(processed).not.toContain('>pt</text>');
    expect(processed).toContain('<text>No-section theorem</text>');
  });

  it('replaces LaTeXML TikZ SVG figures only when PDF-extracted figure crops are available', () => {
    const html = `
      <body>
        <figure class="ltx_figure">
          <svg class="ltx_picture"><text>Botched TikZ text</text></svg>
          <figcaption>Figure 1: Diagram.</figcaption>
        </figure>
      </body>
    `;

    const sourceOnly = postProcessPaperHtml(html, {
      figureImageUrls: ['https://openxiv.net/openxiv-blobs/papers/p1/source-fig-0.png'],
    });
    const pdfCrops = postProcessPaperHtml(html, {
      figureImageUrls: ['https://openxiv.net/openxiv-blobs/papers/p1/v1-fig-0.png'],
      replaceSvgFigures: true,
    });

    expect(sourceOnly).toContain('<svg');
    expect(sourceOnly).toContain('Botched TikZ text');
    expect(pdfCrops).not.toContain('<svg');
    expect(pdfCrops).not.toContain('Botched TikZ text');
    expect(pdfCrops).toContain('src="https://openxiv.net/openxiv-blobs/papers/p1/v1-fig-0.png"');
    expect(pdfCrops).toContain('data-openxiv-inline-figure="1"');
  });
});
