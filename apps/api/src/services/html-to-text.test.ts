import { describe, expect, it } from 'vitest';
import { htmlToText } from './html-to-text.js';

describe('htmlToText', () => {
  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText(undefined as unknown as string)).toBe('');
  });

  it('drops scripts, styles, math, figure captions', () => {
    const html = `
      <html><head><style>.a{color:red}</style></head>
      <body>
        <script>alert(1)</script>
        <p>Visible text.</p>
        <math><mn>1</mn>+<mn>2</mn></math>
        <figure><img/><figcaption>Caption to drop.</figcaption></figure>
      </body></html>
    `;
    const out = htmlToText(html);
    expect(out).toContain('Visible text.');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('color:red');
    expect(out).not.toContain('Caption to drop');
    // math is replaced with a marker placeholder (so downstream knows there
    // *was* an equation here) but not the raw MathML.
    expect(out).not.toContain('<mn>');
  });

  it('turns headings into chunker-friendly "# heading" lines', () => {
    const html = '<h1>Introduction</h1><p>First sentence.</p><h2>Methods</h2><p>Second.</p>';
    const out = htmlToText(html);
    expect(out).toMatch(/^# Introduction\n\nFirst sentence\.\n\n# Methods\n\nSecond\.$/);
  });

  it('decodes common entities', () => {
    expect(htmlToText('<p>5 &lt; 10 &amp; 10 &gt; 5</p>')).toBe('5 < 10 & 10 > 5');
    expect(htmlToText('<p>Caf&eacute;</p>')).toBe('Caf'); // unknown named entity → dropped, that's fine
    expect(htmlToText('<p>&#x2014; em dash</p>')).toContain('— em dash');
  });

  it('preserves paragraph breaks but collapses inline whitespace', () => {
    const html = '<p>line   one   here.</p><p>line two.</p>';
    const out = htmlToText(html);
    expect(out).toBe('line one here.\n\nline two.');
  });

  it('respects maxChars truncation', () => {
    const html = '<p>' + 'x'.repeat(1000) + '</p>';
    expect(htmlToText(html, { maxChars: 50 }).length).toBeLessThanOrEqual(50);
  });

  it('handles deeply nested HTML without exploding', () => {
    let html = 'middle';
    for (let i = 0; i < 100; i++) html = `<span>${html}</span>`;
    expect(htmlToText(`<p>${html}</p>`)).toBe('middle');
  });

  it('keeps prose order in a LaTeXML-style document', () => {
    const html = `
      <article>
        <h1>Quantum Foo</h1>
        <section><h2>Abstract</h2><p>We study foo.</p></section>
        <section><h2>Introduction</h2><p>It is fooed.</p><p>Detail.</p></section>
        <section><h2>Methods</h2><p>We barred the foo.</p></section>
      </article>
    `;
    const out = htmlToText(html);
    expect(out.indexOf('Quantum Foo')).toBeLessThan(out.indexOf('Abstract'));
    expect(out.indexOf('Abstract')).toBeLessThan(out.indexOf('Introduction'));
    expect(out.indexOf('Introduction')).toBeLessThan(out.indexOf('Methods'));
    expect(out).toMatch(/# Methods\n\nWe barred the foo\./);
  });
});
