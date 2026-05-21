import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __testing, classifyTectonicFailure, isTransientTectonicFailure } from './tectonic.js';

describe('classifyTectonicFailure', () => {
  it('classifies cgroup OOM exit code as resource exhaustion', () => {
    expect(classifyTectonicFailure({ code: 137, signal: null, log: '' })).toMatchObject({
      kind: 'oom',
      message: 'tectonic killed by resource limit',
    });
  });

  it('classifies SIGKILL as resource exhaustion when the caller did not time out', () => {
    expect(classifyTectonicFailure({ code: null, signal: 'SIGKILL', log: '' })).toMatchObject({
      kind: 'oom',
      message: 'tectonic killed by resource limit',
    });
  });

  it('keeps ordinary compiler errors distinct from resource exhaustion', () => {
    expect(
      classifyTectonicFailure({
        code: 1,
        signal: null,
        log: '! LaTeX Error: File `missing.sty` not found.',
      }),
    ).toMatchObject({
      kind: 'failure',
      message: 'tectonic exited 1',
    });
  });
});

describe('tectonic entrypoint resolution', () => {
  it('walks deeply nested source archives', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'openxiv-tect-test-'));
    try {
      const sourceDir = path.join(workdir, 'exported', 'submission', 'source');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(sourceDir, 'main.tex'),
        '\\documentclass{article}\n\\begin{document}ok\\end{document}',
      );

      await expect(__testing.findTopLevelTex(workdir)).resolves.toBe(
        path.join(sourceDir, 'main.tex'),
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('prefers the manuscript main.tex over supplement/example TeX files', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'openxiv-tect-test-'));
    try {
      await mkdir(path.join(workdir, 'paper', 'supplements'), { recursive: true });
      await mkdir(path.join(workdir, 'paper', 'examples'), { recursive: true });
      await writeFile(
        path.join(workdir, 'paper', 'main.tex'),
        '\\documentclass{article}\n\\title{Main}\\author{A}\\begin{document}',
      );
      await writeFile(
        path.join(workdir, 'paper', 'supplements', 'supplement.tex'),
        '\\documentclass{article}\n\\title{Supplement}\\begin{document}',
      );
      await writeFile(
        path.join(workdir, 'paper', 'examples', 'template.tex'),
        '\\documentclass{article}\n\\title{Template}\\begin{document}',
      );

      await expect(__testing.findTopLevelTex(workdir)).resolves.toBe(
        path.join(workdir, 'paper', 'main.tex'),
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});

describe('tectonic command planning', () => {
  it('tries a nested entry from its directory first and archive root second', () => {
    const workdir = path.join(os.tmpdir(), 'openxiv-tect-plan');
    const mainTex = path.join(workdir, 'paper', 'main.tex');

    const plans = __testing.buildTectonicCommandPlans(mainTex, workdir);

    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      cwd: path.join(workdir, 'paper'),
    });
    expect(plans[0]?.args.at(-1)).toBe('main.tex');
    expect(plans[1]).toMatchObject({
      cwd: workdir,
    });
    expect(plans[1]?.args.at(-1)).toBe(path.join('paper', 'main.tex'));
  });

  it('searches the entry directory before the archive root recursively', () => {
    const workdir = path.join(os.tmpdir(), 'openxiv-tect-plan');
    const entryDir = path.join(workdir, 'paper');
    const mainTex = path.join(entryDir, 'main.tex');

    const [plan] = __testing.buildTectonicCommandPlans(mainTex, workdir);
    const env = __testing.buildTectonicEnvironment(plan!, 'cache-dir', {
      TEXINPUTS: 'default-tex',
    });

    expect(env['TEXINPUTS']?.split(path.delimiter)).toEqual([
      __testing.kpathseaRecursiveRoot(entryDir),
      __testing.kpathseaRecursiveRoot(workdir),
      'default-tex',
    ]);
    expect(env['BIBINPUTS']?.split(path.delimiter)).toEqual([
      __testing.kpathseaRecursiveRoot(entryDir),
      __testing.kpathseaRecursiveRoot(workdir),
      '',
    ]);
    expect(env['BSTINPUTS']?.split(path.delimiter)).toEqual([
      __testing.kpathseaRecursiveRoot(entryDir),
      __testing.kpathseaRecursiveRoot(workdir),
      '',
    ]);
    expect(env['TEXPICTS']?.split(path.delimiter)).toEqual([
      __testing.kpathseaRecursiveRoot(entryDir),
      __testing.kpathseaRecursiveRoot(workdir),
      '',
    ]);
  });

  it('does not duplicate compile plans for a top-level entry file', () => {
    const workdir = path.join(os.tmpdir(), 'openxiv-tect-plan');
    const mainTex = path.join(workdir, 'main.tex');

    const plans = __testing.buildTectonicCommandPlans(mainTex, workdir);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      cwd: workdir,
    });
    expect(plans[0]?.args.at(-1)).toBe('main.tex');
  });
});

describe('nested archive aliases', () => {
  it('makes root-level archive companions visible beside a nested main.tex', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'openxiv-tect-test-'));
    try {
      const entryDir = path.join(workdir, 'paper');
      await mkdir(entryDir, { recursive: true });
      await mkdir(path.join(workdir, 'shared'), { recursive: true });
      await writeFile(
        path.join(entryDir, 'main.tex'),
        '\\documentclass{article}\\begin{document}\\input{shared/body.tex}\\end{document}',
      );
      await writeFile(path.join(workdir, 'shared', 'body.tex'), 'from root');
      await writeFile(path.join(workdir, 'refs.bib'), '@article{root}');
      await writeFile(path.join(workdir, 'src.zip'), 'archive bytes');

      await __testing.prepareNestedEntryAliases(path.join(entryDir, 'main.tex'), workdir);

      await expect(readFile(path.join(entryDir, 'shared', 'body.tex'), 'utf-8')).resolves.toBe(
        'from root',
      );
      await expect(readFile(path.join(entryDir, 'refs.bib'), 'utf-8')).resolves.toBe(
        '@article{root}',
      );
      await expect(readFile(path.join(entryDir, 'src.zip'))).rejects.toThrow();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});

describe('shouldTryAlternateCompileRoot', () => {
  it('falls back on missing local files that may live relative to archive root', () => {
    expect(
      __testing.shouldTryAlternateCompileRoot({
        code: 1,
        signal: null,
        log: "! LaTeX Error: File `figures/plot.pdf' not found.",
      }),
    ).toBe(true);
  });

  it('does not fall back for ordinary source syntax failures', () => {
    expect(
      __testing.shouldTryAlternateCompileRoot({
        code: 1,
        signal: null,
        log: '! Undefined control sequence.',
      }),
    ).toBe(false);
  });
});

describe('isTransientTectonicFailure', () => {
  it('retries package-cache and network fetch failures', () => {
    expect(
      isTransientTectonicFailure({
        code: 1,
        signal: null,
        log: 'error: failed to download bundle: connection reset by peer',
      }),
    ).toBe(true);
  });

  it('does not retry ordinary LaTeX source errors', () => {
    expect(
      isTransientTectonicFailure({
        code: 1,
        signal: null,
        log: "! LaTeX Error: File `missing.sty' not found.",
      }),
    ).toBe(false);
  });

  it('retries missing core bundle files when the log shows network fetch failures', () => {
    expect(
      isTransientTectonicFailure({
        code: 1,
        signal: null,
        log: "warning: failure requesting SHA256SUM from network\n! LaTeX Error: File `size11.clo' not found.",
      }),
    ).toBe(true);
  });
});
