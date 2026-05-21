/**
 * Strip an HTML document down to readable plain text, preserving paragraph
 * structure (each block-level element becomes its own paragraph) so the
 * downstream section chunker can find heading-shaped lines.
 *
 * NOT a full DOM parser — this is text extraction for embeddings, not safe
 * rendering. Three deliberate simplifications:
 *
 *   1. Scripts, styles, comments, math, figure captions are dropped entirely.
 *      We index searchable prose, not LaTeXML's intermediate math markup.
 *   2. Heading tags (h1..h6) become `# heading text` on their own paragraph
 *      so the chunker's heading regex picks them up. We do this in a single
 *      regex pass over the original HTML rather than the post-strip text so
 *      heading content stays grouped.
 *   3. Inline tags collapse to their text content. Block tags become
 *      paragraph breaks.
 *
 * The result is OK to feed to chunkSections() in services/sections.ts.
 */

const SCRIPT_STYLE_RE = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const MATH_RE = /<math\b[^>]*>[\s\S]*?<\/math>/gi;
const FIGCAP_RE = /<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const HEADING_BLOCK_RE = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
const BLOCK_OPEN_CLOSE_RE =
  /<\/?(?:p|div|section|article|header|footer|aside|main|nav|figure|pre|blockquote|ul|ol|li|table|thead|tbody|tr|td|th|br|hr)\b[^>]*\/?>/gi;
const ANY_TAG_RE = /<[^>]+>/g;
const NAMED_ENTITY_RE = /&([a-zA-Z][a-zA-Z0-9]*);/g;
const NUMERIC_ENTITY_RE = /&#(x?[0-9a-fA-F]+);/g;

/**
 * Named entities we explicitly decode. Anything else we drop — better an
 * empty string than a stray `&eacute;` poisoning a semantic embedding.
 */
const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  emsp: ' ',
  ensp: ' ',
  thinsp: ' ',
};

export interface HtmlToTextOptions {
  /** Hard cap on output characters. Default 200_000 — keeps a runaway doc bounded. */
  maxChars?: number;
}

export function htmlToText(html: string, opts: HtmlToTextOptions = {}): string {
  const maxChars = opts.maxChars ?? 200_000;
  if (typeof html !== 'string' || html.length === 0) return '';

  let body = html;
  // 1. Discard non-textual blocks.
  body = body.replace(SCRIPT_STYLE_RE, '\n');
  body = body.replace(MATH_RE, ' [math] ');
  body = body.replace(FIGCAP_RE, '\n');
  body = body.replace(COMMENT_RE, '');

  // 2. Headings: replace each `<h{n}>X</h{n}>` block with `\n\n# X\n\n`.
  //    Inner tags inside the heading are stripped — heading text is what
  //    we want, not nested span markup.
  body = body.replace(HEADING_BLOCK_RE, (_full, _level: string, inner: string) => {
    const text = inner.replace(ANY_TAG_RE, '').replace(/\s+/g, ' ').trim();
    return text ? `\n\n# ${text}\n\n` : '\n\n';
  });

  // 3. Block-level open/close tags → paragraph breaks. The chunker only
  //    cares about `\n\n` boundaries, so we coalesce later.
  body = body.replace(BLOCK_OPEN_CLOSE_RE, '\n');

  // 4. Strip remaining tags (inline elements: span, em, strong, a, code, …).
  body = body.replace(ANY_TAG_RE, '');

  // 5. Entity decoding. Named entities not in our allowlist are dropped
  //    rather than left as raw `&foo;` — better silent loss than corrupted
  //    text. Numeric entities resolve to code points.
  body = body.replace(NAMED_ENTITY_RE, (_m, name: string) =>
    Object.prototype.hasOwnProperty.call(ENTITY_MAP, name) ? ENTITY_MAP[name]! : '',
  );
  body = body.replace(NUMERIC_ENTITY_RE, (_m, code: string) => {
    const n = code.toLowerCase().startsWith('x')
      ? Number.parseInt(code.slice(1), 16)
      : Number.parseInt(code, 10);
    if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
    try {
      return String.fromCodePoint(n);
    } catch {
      return '';
    }
  });

  // 6. Collapse runs of whitespace inside paragraphs, but keep paragraph breaks.
  body = body
    .split(/\n{2,}/)
    .map((para) => para.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim())
    .filter((para) => para.length > 0)
    .join('\n\n');

  if (body.length > maxChars) body = body.slice(0, maxChars);
  return body.trim();
}
