import { describe, expect, it } from 'vitest';
import { __latexmlTesting } from './real.js';

describe('LaTeXML native worker command plan', () => {
  it('runs latexml and latexmlpost directly with OpenXiv HTML flags', () => {
    const plan = __latexmlTesting.buildLatexmlCommandPlan('/work/main.tex', '/work/out');

    expect(plan).toEqual({
      latexml: {
        command: 'latexml',
        args: ['--dest=/work/out/main.xml', '/work/main.tex'],
      },
      latexmlpost: {
        command: 'latexmlpost',
        args: [
          '--dest=/work/out/main.html',
          '--format=html5',
          '--pmml',
          '--mathtex',
          '/work/out/main.xml',
        ],
      },
      htmlPath: '/work/out/main.html',
    });
  });
});
