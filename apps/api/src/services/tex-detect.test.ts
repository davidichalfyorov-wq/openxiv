import { describe, expect, it } from 'vitest';
import {
  detectEntryTex,
  extractTexMetadata,
  findReferencedPaths,
  looksLikeManuscript,
  missingCompanions,
  stripTexComment,
  type FileNode,
} from './tex-detect.js';

const DOCCLASS = '\\documentclass{article}\n';

function f(path: string, content: string): FileNode {
  return { path, content };
}

describe('stripTexComment', () => {
  it('returns the input unchanged when no % present', () => {
    expect(stripTexComment('hello world')).toBe('hello world');
  });

  it('cuts everything after an unescaped %', () => {
    expect(stripTexComment('foo % this is a comment')).toBe('foo ');
  });

  it('keeps an escaped \\% literal', () => {
    expect(stripTexComment('50\\% growth')).toBe('50\\% growth');
  });

  it('a literal \\\\% IS a comment start', () => {
    // \\ is a literal backslash, then % comments out the rest.
    expect(stripTexComment('end\\\\% trailing')).toBe('end\\\\');
  });
});

describe('looksLikeManuscript', () => {
  it('finds \\documentclass on the very first line', () => {
    expect(looksLikeManuscript('\\documentclass{article}\n\\begin{document}'))
      .toBe(true);
  });

  it('finds \\documentclass with options', () => {
    expect(looksLikeManuscript('\\documentclass[12pt,a4paper]{report}')).toBe(true);
  });

  it('rejects a file with only a commented-out documentclass', () => {
    expect(looksLikeManuscript('% \\documentclass{article}\nbody')).toBe(false);
  });

  it('rejects a file without any documentclass directive', () => {
    expect(looksLikeManuscript('\\section{intro}\nblah')).toBe(false);
  });

  it('ignores documentclass past the first 200 lines (verbatim defence)', () => {
    const padding = Array(220).fill('% padding').join('\n');
    expect(looksLikeManuscript(`${padding}\n\\documentclass{article}`)).toBe(false);
  });
});

describe('detectEntryTex', () => {
  it('returns ok for a single root-level main.tex', () => {
    const r = detectEntryTex([
      f('main.tex', DOCCLASS),
      f('refs.bib', ''),
      f('fig1.pdf', ''),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.path).toBe('main.tex');
  });

  it('accepts custom-named entry like sct_nonperturbative.tex', () => {
    // Mirrors test submissions/02_spectral_measure shape.
    const r = detectEntryTex([
      f('sct_nonperturbative.tex', DOCCLASS),
      f('sct_nonperturbative.bib', ''),
      f('fig_nonpert_2mode.pdf', ''),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.path).toBe('sct_nonperturbative.tex');
  });

  it('walks one subdirectory level (manuscript/main.tex)', () => {
    const r = detectEntryTex([
      f('manuscript/main.tex', DOCCLASS),
      f('manuscript/figs/a.pdf', ''),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.path).toBe('manuscript/main.tex');
  });

  it('walks src/ subdirectory (alternate convention)', () => {
    const r = detectEntryTex([f('src/paper.tex', DOCCLASS), f('src/refs.bib', '')]);
    expect(r.ok).toBe(true);
  });

  it('walks deeply nested export folders when there is a single paper entry', () => {
    const r = detectEntryTex([
      f('openxiv-export-2026/submission/source/main.tex', DOCCLASS),
      f('openxiv-export-2026/submission/source/figures/fig1.pdf', ''),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.path).toBe('openxiv-export-2026/submission/source/main.tex');
  });

  it('chooses the real manuscript over supplemental TeX with its own documentclass', () => {
    const r = detectEntryTex([
      f('paper/main.tex', `${DOCCLASS}\\title{Main paper}\\author{A}\\begin{document}`),
      f('paper/supplements/supplement.tex', `${DOCCLASS}\\title{Supplement}`),
      f('paper/examples/template.tex', `${DOCCLASS}\\title{Example}`),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.path).toBe('paper/main.tex');
  });

  it('no_documentclass when no .tex files', () => {
    const r = detectEntryTex([f('readme.md', '#'), f('cover.pdf', '')]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_documentclass');
  });

  it('no_documentclass when .tex files exist but none has documentclass', () => {
    const r = detectEntryTex([
      f('chapter1.tex', '\\section{Intro}\nbody'),
      f('chapter2.tex', '\\section{Methods}\nmore'),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_documentclass');
  });

  it('multiple_documentclass when two manuscripts in same archive', () => {
    const r = detectEntryTex([
      f('paper1.tex', DOCCLASS),
      f('paper2.tex', DOCCLASS),
      f('refs.bib', ''),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('multiple_documentclass');
      if (r.error === 'multiple_documentclass') {
        expect(r.files).toEqual(['paper1.tex', 'paper2.tex']);
      }
    }
  });

  it('ignores .tex chapters with no documentclass alongside the main paper', () => {
    const r = detectEntryTex([
      f('main.tex', DOCCLASS + '\\input{intro}\n\\input{methods}'),
      f('intro.tex', '\\section{Intro}\nbody'),
      f('methods.tex', '\\section{Methods}\nmore'),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.path).toBe('main.tex');
  });

  it('ignores % \\documentclass in chapter file', () => {
    const r = detectEntryTex([
      f('main.tex', DOCCLASS),
      f('aux.tex', '% \\documentclass{article}\nbody'),
    ]);
    expect(r.ok).toBe(true);
  });

  it('ignores binary files masked as .tex (empty content)', () => {
    const r = detectEntryTex([f('main.tex', DOCCLASS), f('weird.tex', '')]);
    expect(r.ok).toBe(true);
  });
});

describe('extractTexMetadata', () => {
  it('extracts cleaned title, authors, abstract, and pdfkeywords from TeX source', () => {
    const meta = extractTexMetadata(String.raw`
\documentclass{revtex4-2}
\hypersetup{
  pdftitle={Machine title should not win},
  pdfkeywords={regular black hole, causal-set sprinkling}
}
\begin{document}
\title{A de~Sitter region at every black-hole core:\\
discrete causal-set evidence\\
and a canonical regular continuum metric}
\author{David Alfyorov}
\email{david@example.test}
\begin{abstract}
We test finite-\(N\) causal-set sprinkling and Hayward cores.
\end{abstract}
\maketitle
\end{document}
`);

    expect(meta.title).toBe(
      'A de Sitter region at every black-hole core: discrete causal-set evidence and a canonical regular continuum metric',
    );
    expect(meta.authors).toEqual([{ displayName: 'David Alfyorov' }]);
    expect(meta.abstract).toContain('causal-set sprinkling');
    expect(meta.keywords).toEqual(['regular black hole', 'causal-set sprinkling']);
  });

  it('splits common LaTeX author forms and carries affiliations/date/keywords', () => {
    const meta = extractTexMetadata(String.raw`
\documentclass{article}
\title{\textbf{Robust metadata}\\ parsing in \LaTeX}
\author[1]{Alice Alpha and Bob Beta\thanks{Independent lab}}
\author{Carol Gamma}
\affiliation{Institute of Examples}
\date{\today}
\keywords{metadata; indexing, Cyrillic тест}
\begin{abstract}
We parse escaped \% signs, \textbf{macro text}, and Unicode.
\end{abstract}
`);

    expect(meta.title).toBe('Robust metadata parsing in LaTeX');
    expect(meta.authors.map((a) => a.displayName)).toEqual(['Alice Alpha', 'Bob Beta', 'Carol Gamma']);
    expect(meta.authors[0]?.affiliation).toContain('Independent lab');
    expect(meta.authors[2]?.affiliation).toBe('Institute of Examples');
    expect(meta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.keywords).toEqual(['metadata', 'indexing', 'Cyrillic тест']);
  });

  it('preserves renderable inline math in abstracts instead of flattening symbols', () => {
    const meta = extractTexMetadata(String.raw`
\documentclass{article}
\newcommand{\veps}{\varepsilon}
\newcommand{\Ldis}{L_{\rm dS}}
\newcommand{\mtwo}{m_{2,\,{\rm pole}}}
\newcommand{\kapm}{\kappa_{-}}
\begin{document}
\title{Math abstract}
\author{Alice}
\begin{abstract}
Within $\veps_r = 10^{-2} M$, the degree scales as $N^{1.04\pm 0.02}$.
The model fixes $\Ldis = 1/\mtwo$, where $\mtwo = \Lambda\sqrt{z_1}$.
The centre is conformally flat ($C_{abcd}C^{abcd}\to 0$ as $r^6/l^{12}$),
and $\kapm \to \mtwo$ for $M\Lambda \gg 1$.
\end{abstract}
`);

    expect(meta.abstract).toContain('\\(\\varepsilon_r = 10^{-2} M\\)');
    expect(meta.abstract).toContain('\\(N^{1.04\\pm 0.02}\\)');
    expect(meta.abstract).toContain('\\(L_{\\rm dS} = 1/m_{2,\\,{\\rm pole}}\\)');
    expect(meta.abstract).toContain('\\(C_{abcd}C^{abcd}\\to 0\\)');
    expect(meta.abstract).toContain('\\(\\kappa_{-} \\to m_{2,\\,{\\rm pole}}\\)');
  });

  it('parses the three checked-in source submission fixtures', async () => {
    const fs = await import('node:fs/promises');
    const fixtures = [
      {
        path: '../../../../test submissions/04_de_sitter_core/main.tex',
        title: 'A de Sitter region at every black-hole core: discrete causal-set evidence and a canonical regular continuum metric',
        authors: ['David Alfyorov'],
      },
      {
        path: '../../../../test submissions/03_second_law/main.tex',
        title: 'Second-law check through the inner Cauchy horizon of regular black holes with nonlocal fakeon-regulated mass inflation',
        authors: ['David Alfyorov', 'Igor Shnyukov'],
      },
      {
        path: '../../../../test submissions/02_spectral_measure/sct_nonperturbative.tex',
        title: 'Non-perturbative spectral gravity measure in the Hilbert-Schmidt Gaussian completion: pro-torsor structure and the obstruction to canonical expectations',
        authors: ['David Alfyorov', 'Igor Shnyukov'],
      },
    ];
    for (const fixture of fixtures) {
      const source = await fs.readFile(new URL(fixture.path, import.meta.url), 'utf8');
      const meta = extractTexMetadata(source);
      expect(meta.title).toBe(fixture.title);
      expect(meta.authors.map((a) => a.displayName)).toEqual(fixture.authors);
      expect(meta.abstract?.length ?? 0).toBeGreaterThan(80);
    }
  });

  it('keeps de Sitter core fixture abstract math renderable', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(
      new URL('../../../../test submissions/04_de_sitter_core/main.tex', import.meta.url),
      'utf8',
    );
    const meta = extractTexMetadata(source);

    expect(meta.abstract).toContain('\\(\\varepsilon_r = 10^{-2} M\\)');
    expect(meta.abstract).toContain('\\(N^{1.04\\pm 0.02}\\)');
    expect(meta.abstract).toContain('\\(\\max/\\mathrm{mean}\\)');
    expect(meta.abstract).toContain('\\(L_{\\rm dS} = 1/m_{2,\\,{\\rm pole}}\\)');
    expect(meta.abstract).toContain('\\(C_{abcd}C^{abcd}\\to 0\\)');
    expect(meta.abstract).toContain('\\(\\beta=\\gamma=1\\)');
    expect(meta.abstract).not.toContain('eps_r = 10^ -2 M');
    expect(meta.abstract).not.toContain("fixed to the model's spin-2 fakeon-pole inverse, = 1/");
    expect(meta.abstract).not.toContain('where = _1');
  });
});

describe('findReferencedPaths', () => {
  it('extracts \\includegraphics targets', () => {
    const refs = findReferencedPaths('\\includegraphics{fig1.pdf}');
    expect(refs).toContain('fig1.pdf');
  });

  it('handles optional [width=…] argument', () => {
    const refs = findReferencedPaths('\\includegraphics[width=\\linewidth]{plots/fig2}');
    expect(refs).toContain('plots/fig2');
  });

  it('extracts \\bibliography with multiple entries', () => {
    const refs = findReferencedPaths('\\bibliography{refs,extra}');
    expect(refs).toContain('refs');
    expect(refs).toContain('extra');
  });

  it('extracts biblatex \\addbibresource targets', () => {
    const refs = findReferencedPaths('\\addbibresource{references.bib}');
    expect(refs).toContain('references.bib');
  });

  it('extracts \\input and \\include', () => {
    const refs = findReferencedPaths('\\input{preamble}\\include{chapter1}');
    expect(refs).toContain('preamble');
    expect(refs).toContain('chapter1');
  });

  it('deduplicates a repeated reference', () => {
    const refs = findReferencedPaths('\\includegraphics{a.pdf}\n\\includegraphics{a.pdf}');
    expect(refs.filter((r) => r === 'a.pdf')).toHaveLength(1);
  });

  it('finds figure references beyond the preamble', () => {
    const padding = Array(240).fill('Body text.').join('\n');
    const refs = findReferencedPaths(`${padding}\n\\includegraphics{figures/result}`);
    expect(refs).toContain('figures/result');
  });
});

describe('missingCompanions', () => {
  it('returns [] when all references are present', () => {
    expect(missingCompanions(['fig1.pdf'], ['fig1.pdf'])).toEqual([]);
  });

  it('matches basename when path differs', () => {
    expect(missingCompanions(['figs/a.pdf'], ['a.pdf'])).toEqual([]);
  });

  it('matches without extension (TeX adds .pdf/.png/.eps automatically)', () => {
    expect(missingCompanions(['fig1'], ['fig1.pdf'])).toEqual([]);
  });

  it('lists everything not found, sorted', () => {
    expect(missingCompanions(['fig1.pdf', 'refs', 'absent'], ['fig1.pdf'])).toEqual(
      ['absent', 'refs'],
    );
  });
});
