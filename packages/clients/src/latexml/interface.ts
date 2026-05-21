import type { AppResultAsync } from '@openxiv/shared';

export interface ConvertInput {
  readonly source: Buffer;
  readonly filename: string;
}

export interface LatexmlConverter {
  convertToHtml(input: ConvertInput): AppResultAsync<{ html: Buffer; log: string }>;
}
