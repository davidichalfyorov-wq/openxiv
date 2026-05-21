import type { AppResultAsync } from '@openxiv/shared';

export interface ExtractedAuthor {
  readonly displayName: string;
  readonly orcid?: string;
  readonly affiliation?: string;
}

export interface ExtractedMetadata {
  readonly title?: string;
  readonly abstract?: string;
  readonly authors: ExtractedAuthor[];
  readonly references: string[];
  readonly bodyText: string;
}

export interface GrobidExtractor {
  extract(pdf: Buffer): AppResultAsync<ExtractedMetadata>;
}
