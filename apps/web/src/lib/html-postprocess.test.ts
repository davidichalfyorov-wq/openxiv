import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postProcessHtml } from './html-postprocess';

const fixture = readFileSync(
  resolve(process.cwd(), 'test/fixtures/latexml-varied-disciplines.html'),
  'utf8',
);

const squashWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('generic HTML post-processing', () => {
  it('preserves paragraph flow and inline math semantics', () => {
    const processed = postProcessHtml(fixture);

    expect(processed).toContain('<p id="sec-1-p1">');
    // `<math>` now carries `translate="no" lang="en"` attributes before
    // the original LaTeXML attributes — those defend against browser
    // translators wrapping the formula in <font> tags and shredding the
    // KaTeX render tree. The original test asserted the exact attribute
    // ordering, so we accept any prefix between `<math` and the class.
    expect(processed).toMatch(
      /Inline energy\s+<math\b[^>]*class="ltx_Math"[^>]*display="inline"/,
    );
    expect(processed).toMatch(/<math\b[^>]*\btranslate="no"/);
    expect(processed).toContain('remains inside a single paragraph');
    expect(processed).not.toMatch(/<\/p><math\b/);
    expect(processed).not.toContain('display="block"><semantics><mrow><mi>E</mi>');
  });

  it('auto-links bibliography identifiers and keeps malformed fragments plain', () => {
    const processed = postProcessHtml(fixture);

    expect(processed).toContain('href="https://arxiv.org/abs/2301.01234"');
    expect(processed).toContain('href="https://arxiv.org/abs/hep-th/9901001"');
    expect(processed).toContain('href="https://doi.org/10.1145/123.456"');
    expect(squashWhitespace(processed)).toContain('Malformed 10. and arXiv:bad should not link.');
  });

  it('renders compact citation backlinks with sequential numbering', () => {
    const processed = postProcessHtml(fixture);

    // Chips show "↑N" where N is the per-reference occurrence number.
    // Previous markup hard-coded "[1ᵃ]/[1ᵇ]/[1ᶜ]" for every reference, which
    // made every entry in the bibliography look identical — a confusing
    // regression that we now guard against.
    expect(processed).toContain('class="paper-ref-backlink-icon"');
    expect(processed).toContain('class="paper-ref-backlink-chip"');
    expect(processed).toContain('aria-label="Back to citation 1"');
    expect(processed).toContain('aria-label="Back to citation 2"');
    expect(processed).toContain('+2');
    expect(processed).not.toContain('[1ᵃ]');
    expect(processed).not.toContain('[1ᵇ]');
    expect(processed).not.toContain('>back<');
  });

  it('normalizes LaTeXML run-in h6 titles so imported papers do not skip headings', () => {
    const processed = postProcessHtml(
      '<section><h2>Main section</h2><div><h6 class="ltx_title ltx_runin">Lemma 1.</h6><p>Proof.</p></div></section>',
    );

    expect(processed).not.toContain('<h6');
    expect(processed).toContain('<h3 class="ltx_title ltx_runin">Lemma 1.</h3>');
  });

  it('promotes LaTeXML abstract titles so paper pages keep heading order valid', () => {
    const processed = postProcessHtml(
      '<body><article><h1>Paper title</h1><div class="ltx_abstract"><h3 class="ltx_title ltx_title_abstract">Abstract</h3><p>Summary.</p></div></article></body>',
    );

    expect(processed).not.toContain('<h3 class="ltx_title ltx_title_abstract">Abstract</h3>');
    expect(processed).toContain('<h2 class="ltx_title ltx_title_abstract">Abstract</h2>');
  });

  it('turns LaTeXML paragraph titles into styled text instead of skipped headings', () => {
    const processed = postProcessHtml(
      '<body><article><h2>Appendix</h2><section><h4 class="ltx_title ltx_title_paragraph">Proof sketch.</h4><p>Details.</p></section></article></body>',
    );

    expect(processed).not.toContain('<h4 class="ltx_title ltx_title_paragraph">Proof sketch.</h4>');
    expect(processed).toMatch(
      /<p\b[^>]*class="ltx_title ltx_title_paragraph"[^>]*>Proof sketch\.<\/p>/,
    );
  });

  it('wraps tables and normalizes SVG figure dimensions without cropping', () => {
    const processed = postProcessHtml(fixture);

    expect(processed).toContain('<div class="paper-table-wrap"><table>');
    expect(processed).toContain('<svg viewBox="0 0 800 240"');
    expect(processed).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(processed).not.toContain('width="800pt"');
    expect(processed).not.toContain('height="240pt"');
  });

  it('infers column headers for LaTeXML tables that only contain td cells', () => {
    const processed = postProcessHtml(
      '<body><figure><table class="ltx_tabular"><tbody><tr><td colspan="2">Parameter</td><td>Value</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table></figure></body>',
    );

    expect(processed).toContain('<th colspan="2" scope="col">Parameter</th>');
    expect(processed).toContain('<th scope="col">Value</th>');
    expect(processed).toContain('<tr><td>a</td><td>b</td><td>c</td></tr>');
  });

  it('keeps authored table headers unchanged', () => {
    const processed = postProcessHtml(
      '<body><table><tbody><tr><th scope="col">Known</th><td>Value</td></tr></tbody></table></body>',
    );

    expect(processed).toContain('<th scope="col">Known</th><td>Value</td>');
  });

  it('adds responsive loading hints to raster figures without inventing dimensions', () => {
    const processed = postProcessHtml(
      '<body><figure><img src="/figures/plot.png" width="640" height="360" alt="Result plot"></figure></body>',
    );

    expect(processed).toContain(
      '<img loading="lazy" decoding="async" src="/figures/plot.png" width="640" height="360" alt="Result plot">',
    );
  });

  it('turns bibliography sections into a touch-friendly references accordion', () => {
    const processed = postProcessHtml(
      '<body><section id="refs"><h2>References</h2><ul><li id="bib.r1">A. Author. arXiv:2301.01234.</li></ul></section></body>',
    );

    expect(processed).toContain('<details class="paper-references-accordion" open>');
    expect(processed).toContain('<summary>References</summary>');
    expect(processed).toContain('<ul><li id="bib.r1">');
    expect(processed).toContain('href="https://arxiv.org/abs/2301.01234"');
  });
});
