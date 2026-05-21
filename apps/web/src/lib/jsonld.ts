/**
 * Serialize a value for embedding inside a `<script type="application/ld+json">`
 * block. JSON.stringify alone is unsafe inside HTML — `</`, U+2028, and U+2029
 * can each break out of the script context and become injected HTML/JS. We
 * escape the four characters that matter and the two line-separator code
 * points so a paper title containing `</script>` or a stray U+2028 cannot
 * terminate the surrounding block.
 *
 * Use the RegExp constructor for the line-separator code points so esbuild's
 * parser does not choke on literal U+2028 / U+2029 in the source.
 */
const LS_RE = new RegExp('\\u2028', 'g');
const PS_RE = new RegExp('\\u2029', 'g');

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LS_RE, '\\u2028')
    .replace(PS_RE, '\\u2029');
}

/**
 * Stable `@id` for the OpenXiv Organization node. Every JSON-LD object that
 * references the publisher uses this exact string so search engines can
 * reconcile the org across pages instead of treating each page's
 * Organization as a distinct entity.
 */
export const ORG_ID = 'https://openxiv.net/#org';
