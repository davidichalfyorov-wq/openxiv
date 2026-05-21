import { linkCitationText } from './citation-resolver';

/**
 * Post-process LaTeXML/Pandoc HTML into the shape used by OpenXiv readers.
 *
 * This is not a sanitizer. The input is produced by the server-side conversion
 * pipeline, not by arbitrary author-supplied HTML.
 */
export interface PostProcessHtmlOptions {
  readonly figureImageUrls?: readonly string[];
  readonly replaceSvgFigures?: boolean;
}

export function postProcessHtml(html: string, options: PostProcessHtmlOptions = {}): string {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  let inner = bodyMatch ? bodyMatch[1]! : html;

  inner = stripLatexmlChrome(inner);
  inner = normalizeLatexmlHeadings(inner);
  inner = normalizeLatexmlMathAnnotations(inner);
  inner = protectMathFromTranslation(inner);
  inner = addStableAnchors(inner);
  inner = normalizeTableHeaders(inner);
  inner = wrapTables(inner);
  inner = normalizeSvgFigures(inner);
  inner = removeLatexmlSvgTikzUnitArtifacts(inner);
  inner = hydrateLatexmlFigures(
    inner,
    options.figureImageUrls ?? [],
    options.replaceSvgFigures ?? false,
  );
  inner = normalizeRasterFigures(inner);
  inner = wrapReferenceSections(inner);
  inner = addReferenceBacklinks(inner);
  inner = linkBibliographyIdentifiers(inner);
  return inner;
}

/**
 * Tag every <math> element with `translate="no"` so Google Translate
 * (and any other text translator that respects the attribute) leaves
 * them alone. Without this, Chrome / Safari translation passes wrap each
 * character of a typeset formula in `<font>` tags, which fragments the
 * KaTeX-rendered span tree and produces the "equations disappear after
 * a few seconds" failure mode the author reported: the page first
 * renders correctly, then translation kicks in and rewrites the math
 * subtree under us.
 *
 * `translate="no"` cascades to descendants, so a single attribute on the
 * <math> wrapper protects the entire formula. We also add `lang="en"` so
 * translators have an explicit hint about the surrounding language —
 * useful even when the math itself is opted out.
 */
function protectMathFromTranslation(html: string): string {
  return html.replace(/<math\b([^>]*)>/gi, (match, attrs: string) => {
    if (/\stranslate\s*=/i.test(attrs)) return match;
    const lang = /\slang\s*=/i.test(attrs) ? '' : ' lang="en"';
    return `<math translate="no"${lang}${attrs}>`;
  });
}

export function stripLatexmlChrome(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*(?:latexml|ltx|LaTeXML)[^>]*>/gi, '')
    .replace(/\sclass=(["'])ltx_(?:page_(?:main|content|footer|header)|navbar)[^"']*\1/gi, '');
}

function normalizeLatexmlHeadings(html: string): string {
  return html.replace(
    /<h([3-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (full, level: string, attrs: string, body: string) => {
      if (/\bltx_title_abstract\b/i.test(attrs)) return `<h2${attrs}>${body}</h2>`;
      if (/\bltx_title_paragraph\b/i.test(attrs)) return `<p${attrs}>${body}</p>`;
      if (level === '6' && /\bltx_title\b/i.test(attrs)) return `<h3${attrs}>${body}</h3>`;
      return full;
    },
  );
}

export function normalizeLatexmlMathAnnotations(html: string): string {
  return html.replace(
    /(<annotation\b[^>]*\bencoding=(["'])(?:application\/x-(?:tex|latex))\2[^>]*>)([\s\S]*?)(<\/annotation>)/gi,
    (_match, open: string, _quote: string, tex: string, close: string) =>
      `${open}${normalizeLatexForKatex(tex)}${close}`,
  );
}

export function normalizeLatexForKatex(tex: string): string {
  return tex
    .replace(/%[^\r\n]*(?:\r?\n|\r)/g, '')
    .replace(
      /\\(left|right|big|Big|bigl|bigr|Bigl|Bigr|bigm|Bigm|biggl|biggr|Biggl|Biggr)\s*\{(\\[{}])\}/g,
      '\\$1$2',
    )
    .replace(
      /\\(left|right|big|Big|bigl|bigr|Bigl|Bigr|bigm|Bigm|biggl|biggr|Biggl|Biggr)\s*\{([()[\]|.])\}/g,
      '\\$1$2',
    );
}

function addStableAnchors(html: string): string {
  let sectionCounter = 0;
  let inner = html.replace(/<section(\s[^>]*)?>/gi, (match) => {
    sectionCounter += 1;
    if (/\sid\s*=/i.test(match)) return match;
    return `<section id="sec-${sectionCounter}"${match.slice('<section'.length)}`;
  });

  let secIdx = 0;
  inner = inner.replace(/<section\b[^>]*>([\s\S]*?)<\/section>/gi, (full, body: string) => {
    secIdx += 1;
    let pIdx = 0;
    const newBody = body.replace(/<p(\s[^>]*)?>/gi, (match) => {
      pIdx += 1;
      if (/\sid\s*=/i.test(match)) return match;
      return `<p id="sec-${secIdx}-p${pIdx}"${match.slice('<p'.length)}`;
    });
    return full.replace(body, newBody);
  });
  return inner;
}

function wrapTables(html: string): string {
  return html.replace(
    /<table\b(?![^>]*data-openxiv-wrapped)([^>]*)>[\s\S]*?<\/table>/gi,
    (table, _attrs: string, offset: number, full: string) => {
      const before = full.slice(Math.max(0, offset - 100), offset);
      if (/<div\s+class=(["'])paper-table-wrap\1[^>]*>\s*$/i.test(before)) return table;
      return `<div class="paper-table-wrap">${table}</div>`;
    },
  );
}

function normalizeTableHeaders(html: string): string {
  return html.replace(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, (full, attrs: string, body: string) => {
    if (/<th\b/i.test(body)) return full;
    const firstRow = /<tr\b[^>]*>[\s\S]*?<\/tr>/i.exec(body);
    if (!firstRow?.[0]) return full;
    if (!/<td\b/i.test(firstRow[0])) return full;

    const headerRow = firstRow[0]
      .replace(/<td\b([^>]*)>/gi, (_cell, cellAttrs: string) => {
        const nextAttrs = /\sscope\s*=/i.test(cellAttrs)
          ? cellAttrs
          : `${cellAttrs} scope="col"`;
        return `<th${nextAttrs}>`;
      })
      .replace(/<\/td>/gi, '</th>');

    return `<table${attrs}>${body.slice(0, firstRow.index)}${headerRow}${body.slice(
      firstRow.index + firstRow[0].length,
    )}</table>`;
  });
}

function normalizeSvgFigures(html: string): string {
  return html.replace(/<svg\b([^>]*)>/gi, (_match, attrs: string) => {
    const width = getNumericAttr(attrs, 'width');
    const height = getNumericAttr(attrs, 'height');
    const hasViewBox = /\sviewBox\s*=/i.test(attrs);
    const hasPreserveAspectRatio = /\spreserveAspectRatio\s*=/i.test(attrs);
    const retainedAttrs = attrs.replace(/\s(?:width|height)\s*=\s*(["'])[\s\S]*?\1/gi, '').trim();
    const nextAttrs = [
      !hasViewBox && width !== null && height !== null
        ? `viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}"`
        : '',
      !hasPreserveAspectRatio ? 'preserveAspectRatio="xMidYMid meet"' : '',
      retainedAttrs,
    ]
      .filter(Boolean)
      .join(' ');
    return `<svg${nextAttrs ? ` ${nextAttrs}` : ''}>`;
  });
}

function removeLatexmlSvgTikzUnitArtifacts(html: string): string {
  return html.replace(/<svg\b[^>]*\bltx_picture\b[^>]*>[\s\S]*?<\/svg>/gi, (svg) =>
    svg.replace(/<text\b[^>]*>\s*pt\s*<\/text>/gi, ''),
  );
}

function normalizeRasterFigures(html: string): string {
  return html.replace(/<img\b([^>]*?)(\s*\/?)>/gi, (_match, attrs: string, close: string) => {
    const nextAttrs = [
      /\sloading\s*=/i.test(attrs) ? '' : 'loading="lazy"',
      /\sdecoding\s*=/i.test(attrs) ? '' : 'decoding="async"',
      attrs.trim(),
    ]
      .filter(Boolean)
      .join(' ');
    return `<img${nextAttrs ? ` ${nextAttrs}` : ''}${close}>`;
  });
}

function hydrateLatexmlFigures(
  html: string,
  figureImageUrls: readonly string[],
  replaceSvgFigures: boolean,
): string {
  let figureIdx = 0;
  return html.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (figure) => {
    let replacedPlaceholder = false;
    let next = figure.replace(/<img\b([^>]*?)(\s*\/?)>/i, (img, attrs: string, close: string) => {
      if (!isLatexmlMissingFigure(attrs)) return img;
      replacedPlaceholder = true;
      const imageUrl = figureImageUrls[figureIdx++] ?? null;
      const cleaned = stripClassTokens(
        setAttr(attrs, 'alt', ''),
        ['ltx_missing', 'ltx_missing_image'],
      );
      const nextAttrs = imageUrl
        ? setAttr(
            setAttr(cleaned, 'src', imageUrl),
            'data-openxiv-inline-figure',
            '1',
          )
        : setAttr(setAttr(cleaned, 'src', ''), 'data-openxiv-missing-figure', '1');
      return `<img${nextAttrs}${close}>`;
    });

    if (!replaceSvgFigures || replacedPlaceholder || !/<svg\b[^>]*\bltx_picture\b/i.test(next)) {
      return next;
    }
    const imageUrl = figureImageUrls[figureIdx++] ?? null;
    if (!imageUrl) return next;
    return next.replace(
      /<svg\b[^>]*\bltx_picture\b[^>]*>[\s\S]*?<\/svg>/i,
      `<img src="${escapeAttr(imageUrl)}" alt="" data-openxiv-inline-figure="1">`,
    );
  });
}

function isLatexmlMissingFigure(attrs: string): boolean {
  const className = getAttr(attrs, 'class') ?? '';
  const src = getAttr(attrs, 'src');
  const alt = getAttr(attrs, 'alt') ?? '';
  return (
    /\bltx_missing_image\b/i.test(className) ||
    src === '' ||
    /^Refer to caption$/i.test(alt.trim())
  );
}

function getAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attrs);
  return match?.[2] ?? null;
}

function setAttr(attrs: string, name: string, value: string): string {
  const escaped = escapeAttr(value);
  const attr = ` ${name}="${escaped}"`;
  const re = new RegExp(`\\s${name}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i');
  return re.test(attrs) ? attrs.replace(re, attr) : `${attrs}${attr}`;
}

function stripClassTokens(attrs: string, tokens: readonly string[]): string {
  const className = getAttr(attrs, 'class');
  if (className === null) return attrs;
  const remove = new Set(tokens);
  const next = className
    .split(/\s+/)
    .filter((token) => token && !remove.has(token))
    .join(' ');
  return next ? setAttr(attrs, 'class', next) : attrs.replace(/\sclass\s*=\s*(["'])[\s\S]*?\1/i, '');
}

function wrapReferenceSections(html: string): string {
  return html.replace(
    /<section\b([^>]*)>([\s\S]*?)<\/section>/gi,
    (full, attrs: string, body: string) => {
      if (/paper-references-accordion/.test(body)) return full;
      const heading = /<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/i.exec(body);
      if (!heading || heading.index === undefined) return full;
      const label = htmlToText(heading[3] ?? '').trim();
      if (!/^(references|bibliography|works cited)\b/i.test(label)) return full;

      const before = body.slice(0, heading.index + heading[0].length);
      const after = body.slice(heading.index + heading[0].length).trim();
      if (!after) return full;

      return `<section${attrs}>${before}<details class="paper-references-accordion" open><summary>${escapeHtml(label)}</summary>${after}</details></section>`;
    },
  );
}

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
}

function getNumericAttr(attrs: string, name: string): number | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']+)\\1`, 'i').exec(attrs);
  if (!match?.[2]) return null;
  const numeric = Number.parseFloat(match[2]);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function linkBibliographyIdentifiers(html: string): string {
  return html.replace(
    /<(li|p|div|span)([^>]*\sid=(["'])bib[A-Za-z0-9_.:-]+\3[^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string, _quote: string, body: string) => {
      if (/paper-citation-link/.test(body)) return full;
      return `<${tag}${attrs}>${linkCitationText(body)}</${tag}>`;
    },
  );
}

function addReferenceBacklinks(html: string): string {
  const refs = new Map<string, string[]>();
  let refIdx = 0;
  const withRefs = html.replace(
    /<a\b([^>]*?)href=(["'])#(bib[A-Za-z0-9_.:-]+)\2([^>]*)>/gi,
    (match, pre: string, quote: string, target: string, post: string) => {
      refIdx += 1;
      const id = `ref-${target.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${refIdx}`;
      const ids = refs.get(target) ?? [];
      ids.push(id);
      refs.set(target, ids);
      const withId = /\sid\s*=/i.test(match)
        ? match
        : `<a id="${id}"${pre}href=${quote}#${target}${quote}${post}>`;
      return /\sdata-bib-ref\s*=/i.test(withId)
        ? withId
        : withId.replace(/>$/, ` data-bib-ref="${target}">`);
    },
  );

  let out = withRefs;
  for (const [target, ids] of refs) {
    const escaped = escapeRegExp(target);
    const targetRe = new RegExp(
      `<(li|p|div|span)([^>]*\\sid=(["'])${escaped}\\3[^>]*)>([\\s\\S]*?)<\\/\\1>`,
      'i',
    );
    out = out.replace(
      targetRe,
      (full, tag: string, attrs: string, _quote: string, body: string) => {
        if (/paper-ref-backlink/.test(body)) return full;
        return `<${tag}${attrs}>${body} ${backlinkMarkup(ids)}</${tag}>`;
      },
    );
  }
  return out;
}

/**
 * Render the small chip(s) that let a reader jump from a reference entry
 * back to the place(s) in text where it's cited. We surface up to three
 * citations explicitly and roll the rest into a "+N" pill.
 *
 * The numbers on the chips are **per-reference sequential positions**, i.e.
 * "↑1" jumps to the first occurrence of this specific reference in the
 * body, "↑2" to the second, etc. They are NOT the bibliography number —
 * that would be redundant with the entry the chips live on.
 */
function backlinkMarkup(ids: string[]): string {
  if (ids.length === 1) {
    return `<span class="paper-ref-backlinks"><a class="paper-ref-backlink" href="#${ids[0]}" aria-label="Back to citation"><span class="paper-ref-backlink-icon" aria-hidden="true">↑</span></a></span>`;
  }
  const visible = ids.slice(0, 3);
  const chips = visible
    .map((id, index) => {
      const n = index + 1;
      return `<a class="paper-ref-backlink-chip" href="#${id}" aria-label="Back to citation ${n}"><span class="paper-ref-backlink-icon" aria-hidden="true">↑</span>${n}</a>`;
    })
    .join(' ');
  const more =
    ids.length > visible.length
      ? ` <span class="paper-ref-backlink-more" aria-label="${ids.length - visible.length} more citation backlinks">+${ids.length - visible.length}</span>`
      : '';
  return `<span class="paper-ref-backlinks" aria-label="Back to citations">${chips}${more}</span>`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
