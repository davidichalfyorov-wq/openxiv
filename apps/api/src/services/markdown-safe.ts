/**
 * Tiny markdown-safe renderer for moderator-written reason cards.
 *
 * We do NOT trust author-supplied HTML — even though only admins write
 * reason cards, "admin" is a small group and we want the same code path
 * to be safe if/when this ever opens up.
 *
 * Supported subset:
 *   - Paragraphs (blank-line separated).
 *   - Inline **bold**, *italic*, `code`.
 *   - Links: [text](https://…) — only http(s) URLs.
 *   - Bullet lists: lines starting with `- `.
 *
 * Anything else passes through as escaped plain text. No raw HTML allowed.
 */

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

const URL_OK = /^https?:\/\/[^\s)]+$/i;

function renderInline(text: string): string {
  let out = escapeText(text);
  // Links first so the URL escape doesn't get re-escaped.
  out = out.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g, (m, label, raw) => {
    // Decoded URL needs validation against URL_OK — we escaped earlier so
    // it'll look like https:&#x2F;&#x2F;… here; un-escape just for the check.
    const url = raw.replace(/&amp;/g, '&');
    if (!URL_OK.test(url)) return m; // leave the literal text as-is
    return `<a href="${url}" rel="noopener" target="_blank">${label}</a>`;
  });
  // Bold then italic — pinpoint order so `**a*b*c**` works as `<b>a*b*c</b>`.
  out = out.replace(/\*\*([^*]{1,200})\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]{1,200})\*/g, '<em>$1</em>');
  out = out.replace(/`([^`]{1,200})`/g, '<code>$1</code>');
  return out;
}

export function renderSafeMarkdown(md: string): string {
  if (typeof md !== 'string' || md.length === 0) return '';
  const blocks: string[] = [];
  let i = 0;
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    // Bullet list — consecutive `- ` lines.
    if (/^\s{0,3}-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s{0,3}-\s+/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^\s{0,3}-\s+/, '');
        items.push(`<li>${renderInline(itemText)}</li>`);
        i += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    // Paragraph — accumulate until blank line.
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      para.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push(`<p>${renderInline(para.join(' '))}</p>`);
  }
  return blocks.join('\n');
}
