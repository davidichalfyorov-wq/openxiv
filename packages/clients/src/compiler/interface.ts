import type { AppResultAsync } from '@openxiv/shared';

export interface CompileInput {
  /** Tarball or single .tex file (bytes). */
  readonly source: Buffer;
  /** Original filename — used to detect tarball vs single-file. */
  readonly filename: string;
}

export interface CompileResult {
  readonly pdf: Buffer;
  readonly log: string;
  readonly durationMs: number;
}

export interface LatexCompiler {
  compile(input: CompileInput): AppResultAsync<CompileResult>;
}
