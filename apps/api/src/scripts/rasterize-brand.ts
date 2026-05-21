/* eslint-disable no-console -- One-shot asset script intentionally reports the generated file. */
/**
 * One-shot SVG → PNG conversion for brand assets that pdf-lib needs to
 * embed (pdf-lib can't read SVG natively). Run when the brand asset
 * changes; commit the resulting PNG to source so the cover generator
 * doesn't pull in resvg as a runtime dependency.
 *
 *   pnpm -F @openxiv/api exec tsx src/scripts/rasterize-brand.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const inSvg = resolve(REPO_ROOT, 'apps/web/public/brand/logo-full.svg');
const outPng = resolve(import.meta.dirname, '..', 'services', 'brand', 'logo-full.png');

const svg = readFileSync(inSvg);
// Render at 4x the SVG viewBox width (377 × 4 = 1508 px) so embedded
// scaling stays crisp at any cover-page size.
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1508 },
  background: 'rgba(0, 0, 0, 0)',
});
const png = resvg.render().asPng();
writeFileSync(outPng, png);
console.log(`wrote ${png.length} bytes → ${outPng}`);
