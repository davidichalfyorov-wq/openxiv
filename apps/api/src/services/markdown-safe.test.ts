import { describe, expect, it } from 'vitest';
import { renderSafeMarkdown } from './markdown-safe.js';

describe('renderSafeMarkdown', () => {
  it('escapes raw HTML', () => {
    const html = renderSafeMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('wraps a single paragraph', () => {
    const html = renderSafeMarkdown('Hello world.');
    expect(html).toBe('<p>Hello world.</p>');
  });

  it('renders bold, italic, code inline', () => {
    const html = renderSafeMarkdown('A **bold** and *italic* and `code` word.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders http(s) links with rel="noopener"', () => {
    const html = renderSafeMarkdown('Read [the paper](https://example.com/p).');
    expect(html).toContain('<a href="https://example.com/p" rel="noopener" target="_blank">the paper</a>');
  });

  it('rejects javascript: URLs and data: URLs in links', () => {
    const jsLink = renderSafeMarkdown('[click](javascript:alert(1))');
    expect(jsLink).not.toContain('href=');
    expect(jsLink).toContain('[click](javascript:alert(1))');
    const dataLink = renderSafeMarkdown('[click](data:text/html,xss)');
    expect(dataLink).not.toContain('href=');
  });

  it('handles bullet lists', () => {
    const html = renderSafeMarkdown('- one\n- two\n- three');
    expect(html).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>');
  });

  it('handles paragraphs separated by blank lines', () => {
    const html = renderSafeMarkdown('first paragraph\n\nsecond paragraph');
    expect(html).toBe('<p>first paragraph</p>\n<p>second paragraph</p>');
  });

  it('escapes quotes so attempted handler injection lands as plain text', () => {
    // Source tries to break out of an attribute and inject onclick=. Because
    // markdown never emits an open tag whose attribute we'd be sitting in,
    // the only way "onclick" ends up in the output is as inert text — but
    // the quotes that would close an attribute are escaped to entities.
    const html = renderSafeMarkdown('plain text " onclick="alert(1)');
    expect(html).toMatch(/^<p>plain text &quot; onclick=&quot;alert\(1\)<\/p>$/);
  });

  it('handles empty input gracefully', () => {
    expect(renderSafeMarkdown('')).toBe('');
    expect(renderSafeMarkdown(undefined as unknown as string)).toBe('');
  });

  it('respects max-length on inline patterns to avoid catastrophic regex', () => {
    const long = '*' + 'a'.repeat(5000) + '*';
    const html = renderSafeMarkdown(long);
    // The italic regex caps at 200 chars per match; a 5000-char block
    // should NOT take exponential time and should not contain <em>.
    expect(html).not.toContain('<em>');
  });
});
