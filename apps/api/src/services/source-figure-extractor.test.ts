import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sourceFigureUploadKey, __testing, type SourceFigureAsset } from './source-figure-extractor.js';
import type { FileNode } from './tex-detect.js';

const { collectSourceFigureCandidates, captionFromPath, shouldIgnoreArchivePath } = __testing;

function file(path: string, marker = path): FileNode {
  return { path, content: /\.tex$/i.test(path) ? marker : '', bytes: Buffer.from(marker) };
}

describe('source figure extraction candidates', () => {
  it('finds figures by extension across arbitrary names and nested folders', () => {
    const candidates = collectSourceFigureCandidates([
      file('main.tex'),
      file('zz/deep/nested/final overview 2.PDF'),
      file('assets/plot-without-fig-prefix.PNG'),
      file('supplement/images/anything.jpeg'),
      file('vectors/diagram.svg'),
      file('__MACOSX/ignored.png'),
      file('._ignored.png'),
      { path: 'empty.pdf', content: '' },
    ]);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'assets/plot-without-fig-prefix.PNG',
      'vectors/diagram.svg',
      'zz/deep/nested/final overview 2.PDF',
    ]);
    expect(candidates.map((candidate) => candidate.contentType)).toEqual([
      'image/png',
      'image/png',
      'image/png',
    ]);
  });

  it('prefers actual TeX includegraphics assets over unrelated PDFs and images', () => {
    const candidates = collectSourceFigureCandidates([
      file(
        'paper/main.tex',
        String.raw`
          \includegraphics[width=\linewidth]{strange assets/data product}
          \includegraphics{../plots/another.result.png}
        `,
      ),
      file('paper/strange assets/data product.PDF'),
      file('plots/another.result.png'),
      file('paper/main.pdf'),
      file('paper/supplement.pdf'),
      file('paper/unreferenced-logo.png'),
    ]);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'paper/strange assets/data product.PDF',
      'plots/another.result.png',
    ]);
  });

  it('resolves graphicspath directories without relying on figure-like names', () => {
    const candidates = collectSourceFigureCandidates([
      file(
        'src/main.tex',
        String.raw`
          \graphicspath{{../visual assets/}{charts/final/}}
          \includegraphics{experiment-output-v17}
        `,
      ),
      file('visual assets/experiment-output-v17.svg'),
      file('src/charts/final/other-output.pdf'),
    ]);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'visual assets/experiment-output-v17.svg',
    ]);
  });

  it('falls back only to safe media assets when TeX has no explicit graphics refs', () => {
    const candidates = collectSourceFigureCandidates([
      file('main.pdf'),
      file('build/compiled-page.pdf'),
      file('tmp/cache-plot.png'),
      file('supplement/appendix-plot.png'),
      file('supplements/result.png'),
      file('assets/openxiv-logo.png'),
      file('media/readme-icon.svg'),
      file('assets/raw-export-v3.pdf'),
      file('media/output-with-arbitrary-name.webp'),
    ]);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'assets/raw-export-v3.pdf',
      'media/output-with-arbitrary-name.webp',
    ]);
  });

  it('returns no candidates for manuscripts that have no figures', () => {
    const candidates = collectSourceFigureCandidates([
      file('main.tex', String.raw`\section{No figures here} Plain text only.`),
      file('refs.bib'),
      file('notes/readme.txt'),
    ]);

    expect(candidates).toEqual([]);
  });

  it('finds every submitted figure in the de Sitter source tree', async () => {
    const root = new URL('../../../../test submissions/04_de_sitter_core/', import.meta.url);
    const names = await readdir(root);
    const files = await Promise.all(
      names.map(async (name): Promise<FileNode> => {
        const bytes = await readFile(new URL(name, root));
        return { path: name, content: name.endsWith('.tex') ? bytes.toString('utf8') : '', bytes };
      }),
    );
    const candidates = collectSourceFigureCandidates(files);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'fig2_consistency.pdf',
      'fig1_overview.pdf',
      'fig3_ppn.pdf',
      'fig4_mass_inflation.pdf',
      'fig5_sprinkling.pdf',
      'fig6_eps_deep.pdf',
    ]);
  });

  it('ignores platform metadata and labels source fallback captions clearly', () => {
    expect(shouldIgnoreArchivePath('__MACOSX/fig.png')).toBe(true);
    expect(shouldIgnoreArchivePath('figs/._fig.png')).toBe(true);
    expect(shouldIgnoreArchivePath('figs/real.png')).toBe(false);
    expect(captionFromPath('nested/any-name.pdf')).toBe('Source figure: any-name.pdf');
  });

  it('uses deterministic source figure upload keys per figure content', () => {
    const figure: SourceFigureAsset = {
      idx: 3,
      data: Buffer.from('image bytes'),
      contentType: 'image/png',
      extension: 'png',
      caption: null,
      originalPath: 'plots/result.pdf',
    };

    expect(sourceFigureUploadKey({ paperId: 'paper-1', version: 2, figure })).toMatch(
      /^papers\/paper-1\/v2-source-fig-3-[0-9a-f]{12}\.png$/,
    );
  });
});
