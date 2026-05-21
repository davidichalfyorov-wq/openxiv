import { ResultAsync } from '@openxiv/shared';
import type { CompileInput, CompileResult, LatexCompiler } from './interface.js';

/**
 * A minimal valid one-page PDF — enough for PDF.js to render a blank page.
 * Used in tests and dev when no tectonic image is present.
 */
const STUB_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f \n' +
    '0000000009 00000 n \n0000000052 00000 n \n0000000095 00000 n \n' +
    'trailer<</Size 4/Root 1 0 R>>\nstartxref\n141\n%%EOF\n',
);

export function makeMockCompiler(): LatexCompiler {
  return {
    compile(input: CompileInput) {
      const log = `[mock tectonic] received ${input.filename} (${input.source.length} bytes)\nLaTeX Warning: this is a stub PDF.\n`;
      const result: CompileResult = {
        pdf: STUB_PDF,
        log,
        durationMs: 50,
      };
      return ResultAsync.fromSafePromise(Promise.resolve(result));
    },
  };
}
