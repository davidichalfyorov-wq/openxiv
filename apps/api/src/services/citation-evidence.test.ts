import { describe, expect, it } from 'vitest';
import {
  extractCitationContentEvidence,
  extractCitationEvidenceItemsFromSections,
  extractCitationSectionsFromSourceFiles,
} from './citation-evidence.js';

describe('citation evidence extraction', () => {
  it('finds bibliography entries when the References heading was lost by chunk merging', () => {
    const sections = [
      {
        title: 'Conclusion',
        content: [
          'The estimate follows the prior numerical pipeline [1,2] and the survey argument (Einstein, 1916).',
          '[1] A. Einstein, Annalen der Physik. https://doi.org/10.1002/andp.19163540702',
          '[2] R. Penrose, Gravitational collapse and space-time singularities. doi:10.1103/PhysRevLett.14.57',
          'Smith, J. (2020). Stable archive for the numerical data. https://example.org/openxiv/data',
        ].join('\n'),
      },
    ];

    const evidence = extractCitationContentEvidence(sections);

    expect(evidence.hasReferenceSection).toBe(true);
    expect(evidence.citationMarkerCount).toBeGreaterThanOrEqual(3);
    expect(evidence.referenceEntryCount).toBe(3);
    expect(evidence.resolvedReferenceCount).toBe(3);
  });

  it('splits an inline References heading out of a merged indexed section', () => {
    const sections = [
      {
        title: 'Discussion',
        content: [
          'The stated comparison depends on [1].',
          'References',
          '[1] R. Wald. Black hole mechanics. arXiv:gr-qc/9305022',
          '[2] Reproducibility notes. https://example.org/repro',
        ].join('\n'),
      },
    ];

    const evidence = extractCitationContentEvidence(sections);
    const items = extractCitationEvidenceItemsFromSections(sections);

    expect(evidence).toMatchObject({
      hasReferenceSection: true,
      citationMarkerCount: 1,
      referenceEntryCount: 2,
      resolvedReferenceCount: 2,
    });
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Citation [1]',
          resolved: 'arXiv:gr-qc/9305022',
          via: 'arxiv',
          status: 'pass',
        }),
      ]),
    );
  });

  it('resolves TeX citation commands, author-year references, DOI, arXiv, and stable URLs', () => {
    const sections = [
      {
        title: 'Main result',
        content:
          'We combine \\parencite{smith2020,doe2021} with [3-4] and the classic comparison (Penrose, 1965).',
      },
      {
        title: 'Bibliography',
        content: [
          '\\bibitem{smith2020} J. Smith. A stable source. arXiv:2001.00001',
          '\\bibitem{doe2021} J. Doe. DOI-backed source. https://doi.org/10.5555/example.1',
          '[3] Dataset and scripts. https://example.org/openxiv/scripts',
          '[4] Local note without an identifier.',
          'Penrose, R. (1965). Singularities. doi:10.1103/PhysRevLett.14.57',
        ].join('\n'),
      },
    ];

    const evidence = extractCitationContentEvidence(sections);
    const items = extractCitationEvidenceItemsFromSections(sections);

    expect(evidence.hasReferenceSection).toBe(true);
    expect(evidence.citationMarkerCount).toBeGreaterThanOrEqual(5);
    expect(evidence.referenceEntryCount).toBe(5);
    expect(evidence.resolvedReferenceCount).toBe(4);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: '{smith2020}', resolved: 'arXiv:2001.00001' }),
        expect.objectContaining({ ref: '{doe2021}', resolved: '10.5555/example.1' }),
        expect.objectContaining({ ref: '[3]', via: 'url' }),
        expect.objectContaining({ ref: '[4]', resolved: null, status: 'fail' }),
        expect.objectContaining({ ref: '(Penrose, 1965)', resolved: '10.1103/PhysRevLett.14.57' }),
      ]),
    );
  });

  it('counts rendered BibTeX-key citation markers from LaTeXML missing-citation output', () => {
    const sections = [
      {
        title: 'Solar-system bound',
        content:
          'The calibration follows [Chamseddine:1996zu, Connes:2006qj] and the later comparison [Lee:2020].',
      },
      {
        title: 'References',
        content: [
          '@article{Chamseddine:1996zu,',
          '  author = {Chamseddine, Ali H. and Connes, Alain},',
          '  doi = {10.1007/BF02096950}',
          '}',
          '@article{Connes:2006qj,',
          '  eprint = {hep-th/0608226},',
          '  archivePrefix = {arXiv}',
          '}',
          '@article{Lee:2020,',
          '  url = {https://example.org/stable-comparison}',
          '}',
        ].join('\n'),
      },
    ];

    const evidence = extractCitationContentEvidence(sections);
    const items = extractCitationEvidenceItemsFromSections(sections);

    expect(evidence).toMatchObject({
      hasReferenceSection: true,
      citationMarkerCount: 3,
      referenceEntryCount: 3,
      resolvedReferenceCount: 3,
    });
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: '{Chamseddine:1996zu}', resolved: '10.1007/BF02096950' }),
        expect.objectContaining({ ref: '{Connes:2006qj}', resolved: 'arXiv:hep-th/0608226' }),
        expect.objectContaining({ ref: '{Lee:2020}', via: 'url', status: 'pass' }),
      ]),
    );
  });

  it('builds citation sections from retained TeX source and bundled BibTeX files', () => {
    const sourceSections = extractCitationSectionsFromSourceFiles([
      {
        path: 'paper/main.tex',
        content: [
          '\\documentclass{article}',
          '\\begin{document}',
          'The argument uses \\cite{CC:1996,moduli2021}.',
          '\\bibliography{refs/sct}',
          '\\end{document}',
        ].join('\n'),
      },
      {
        path: 'paper/refs/sct.bib',
        content: [
          '@article{CC:1996,',
          '  title = {Spectral action},',
          '  doi = {10.1007/BF02096950}',
          '}',
          '@article{moduli2021,',
          '  eprint = {2107.08485},',
          '  archivePrefix = {arXiv}',
          '}',
        ].join('\n'),
      },
    ]);

    const evidence = extractCitationContentEvidence(sourceSections);
    const items = extractCitationEvidenceItemsFromSections(sourceSections);

    expect(evidence).toMatchObject({
      hasReferenceSection: true,
      citationMarkerCount: 2,
      referenceEntryCount: 2,
      resolvedReferenceCount: 2,
    });
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: '{CC:1996}', resolved: '10.1007/BF02096950' }),
        expect.objectContaining({ ref: '{moduli2021}', resolved: 'arXiv:2107.08485' }),
      ]),
    );
  });
});
