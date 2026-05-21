import { describe, expect, it } from 'vitest';
import { postProcessPaperHtml } from './paper-html';

describe('postProcessPaperHtml', () => {
  it('strips LaTeXML page chrome, wraps wide tables, and adds reference backlinks', () => {
    const html = `<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="LaTeXML.css">
  <style>.ltx_page_main{width:45em}</style>
</head>
<body>
  <article>
    <p>See <a href="#bib.bib1">[1]</a> for a long URL https://example.test/a/really/long/path.</p>
    <table><tbody><tr><td>wide</td></tr></tbody></table>
    <ul><li id="bib.bib1">A reference.</li></ul>
  </article>
</body>
</html>`;

    const processed = postProcessPaperHtml(html);

    expect(processed).not.toContain('LaTeXML.css');
    expect(processed).not.toContain('ltx_page_main');
    expect(processed).toContain('<div class="paper-table-wrap"><table>');
    expect(processed).toContain('data-bib-ref="bib.bib1"');
    expect(processed).toContain('class="paper-ref-backlink"');
    expect(processed).toContain('href="#ref-bib-bib1-1"');
  });

  it('normalizes LaTeXML TeX annotations before client-side KaTeX rendering', () => {
    const html = `<body>
      <math display="block">
        <semantics>
          <annotation encoding="application/x-tex">S=\\frac{1}{16\\pi G}\\int\\sqrt{-g}\\,\\bigl{[}\\,R\\\\
{}+\\alpha_{C}\\,C_{abcd}\\,\\bigr{]}+S_{\\rm
scalar}</annotation>
        </semantics>
      </math>
      <math display="block">
        <semantics>
          <annotation encoding="application/x-latex">L_{\\rm dS}^{2}=\\frac{l^{3}}{2M},\\qquad f(r)\\big{|}_{r\\ll l}=1-\\frac{r^{2}}{L_{%
\\rm dS}^{2}}</annotation>
        </semantics>
      </math>
      <math display="block">
        <semantics>
          <annotation encoding="application/x-tex">X=\\bigl{\\{}A\\in B(H):A=A^*\\bigr{\\}}</annotation>
        </semantics>
      </math>
    </body>`;

    const processed = postProcessPaperHtml(html);

    expect(processed).toContain('\\bigl[');
    expect(processed).toContain('\\bigr]');
    expect(processed).toContain('\\bigl\\{');
    expect(processed).toContain('\\bigr\\}');
    expect(processed).toContain('\\big|');
    expect(processed).not.toContain('\\bigl{[}');
    expect(processed).not.toContain('\\bigr{]}');
    expect(processed).not.toContain('\\bigl{\\{}');
    expect(processed).not.toContain('\\bigr{\\}}');
    expect(processed).not.toContain('\\big{|}');
    expect(processed).not.toContain('L_{%');
  });
});
