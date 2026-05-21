import type { AppResultAsync } from '@openxiv/shared';

export interface KeywordExtractor {
  extract(text: string, opts?: { max?: number }): AppResultAsync<string[]>;
}
