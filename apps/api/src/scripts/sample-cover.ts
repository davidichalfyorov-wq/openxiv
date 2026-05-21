/* eslint-disable no-console -- One-shot sample generator intentionally reports the output path/hash. */
/**
 * One-shot sample cover generator for demonstration.
 * Uses a fake DOI under prefix 10.99999 so the output cannot be
 * mistaken for a registered Crossref record.
 *
 *   pnpm -F @openxiv/api exec tsx src/scripts/sample-cover.ts
 *
 * Output: D:\OpenXiv\sample-cover.pdf
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateCoverPdf } from '../services/pdf-cover.js';

const SAMPLE = {
  openxivId: 'openxiv:math-ph.2026.00001',
  openxivUrlId: 'math-ph.2026.00001',
  title:
    'Non-perturbative spectral gravity measure in the Hilbert–Schmidt Gaussian completion: pro-torsor structure and the obstruction to canonical expectations',
  abstract:
    'Sample preprint cover used for demonstration only. The DOI shown is a placeholder under prefix 10.99999 and resolves to nothing.',
  authors: [
    {
      displayName: 'David Alfyorov',
      orcid: '0009-0003-6027-7837',
      affiliation: 'Independent researcher',
    },
    {
      displayName: 'Igor Shnyukov',
      affiliation: 'Independent researcher',
    },
  ],
  primaryCategory: 'math-ph',
  crossListings: ['hep-th', 'gr-qc'],
  license: 'CC-BY-4.0',
  version: 1,
  postedAt: '2026-05-19T12:00:00.000Z',
  disclosureLevel: 'assistant' as const,
  trust: {
    transparency: 'strong' as const,
    identity: 'strong' as const,
    provenance: 'strong' as const,
    citations: 'partial' as const,
    math: 'strong' as const,
    integrity: 'strong' as const,
  },
  doi: '10.99999/openxiv.math-ph.2026.00001',
  publicBase: 'https://openxiv.net',
};

const out = await generateCoverPdf(SAMPLE);
const outPath = resolve(import.meta.dirname, '..', '..', '..', '..', 'sample-cover.pdf');
writeFileSync(outPath, out.buffer);
console.log(`wrote ${out.buffer.length} bytes → ${outPath}`);
console.log(`contentHash: ${out.contentHash}`);
