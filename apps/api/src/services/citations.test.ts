import { describe, expect, it } from 'vitest';
import { generateCitation, normalizeCitationFormat } from './citations.js';
import type { PaperAuthorRecord, PaperRecord } from '@openxiv/db';

const basePaper = {
  id: '11111111-1111-4111-8111-111111111111',
  openxivId: 'openxiv:physics.gen-ph.2026.00001',
  uri: 'at://did/app.openxiv.preprint/abc',
  cid: null,
  submitterDid: 'did:web:openxiv.net:u:orcid.0000',
  title: 'A Robust Test of Café Metadata & Fields',
  abstract: 'Abstract',
  license: 'CC-BY-4.0',
  primaryCategory: 'physics.gen-ph',
  crossListings: [],
  doi: null,
  status: 'published',
  versionNote: null,
  supersedesUri: null,
  submissionTermsVersion: null,
  submissionTermsAcceptedAt: null,
  oneHardQuestion: null,
  launchKit: null,
  createdAt: new Date('2026-05-01T12:00:00Z'),
  updatedAt: new Date('2026-05-01T12:00:00Z'),
  publishedAt: new Date('2026-05-02T12:00:00Z'),
} satisfies PaperRecord;

const authors = [
  author(0, 'Alice Smith'),
  author(1, 'Bob Jones'),
  author(2, 'Carol García'),
] satisfies PaperAuthorRecord[];

describe('generateCitation', () => {
  it('normalizes unknown formats to bibtex', () => {
    expect(normalizeCitationFormat('weird')).toBe('bibtex');
    expect(normalizeCitationFormat('RIS')).toBe('ris');
  });

  it('generates escaped BibTeX with OpenXiv URL when DOI is missing', () => {
    const text = generateCitation(
      { paper: basePaper, authors, keywords: ['metadata', 'café'], latestVersion: null },
      'bibtex',
      { publicBase: 'https://openxiv.net' },
    );
    expect(text).toContain('@article{physics_gen_ph_2026_00001,');
    expect(text).toContain('title = {A Robust Test of Café Metadata \\& Fields}');
    expect(text).toContain('author = {Alice Smith and Bob Jones and Carol García}');
    expect(text).toContain('url = {https://openxiv.net/p/physics.gen-ph.2026.00001}');
    expect(text).not.toContain('doi =');
  });

  it('generates RIS records with one AU line per author', () => {
    const text = generateCitation(
      { paper: basePaper, authors, keywords: ['metadata'], latestVersion: null },
      'ris',
      { publicBase: 'https://openxiv.net' },
    );
    expect(text).toContain('TY  - JOUR');
    expect(text.match(/^AU  - /gm)).toHaveLength(3);
    expect(text).toContain('ER  - ');
  });

  it('uses et al. in prose formats when appropriate', () => {
    const manyAuthors = Array.from({ length: 7 }, (_, idx) => author(idx, `Author ${idx}`));
    const ieee = generateCitation(
      { paper: basePaper, authors: manyAuthors, keywords: [], latestVersion: null },
      'ieee',
      { publicBase: 'https://openxiv.net' },
    );
    expect(ieee).toContain('et al.');
  });
});

function author(position: number, displayName: string): PaperAuthorRecord {
  return {
    paperId: basePaper.id,
    position,
    did: null,
    displayName,
    orcid: null,
    affiliation: null,
    affiliationRor: null,
    creditRoles: [],
    isCorresponding: position === 0,
  };
}
