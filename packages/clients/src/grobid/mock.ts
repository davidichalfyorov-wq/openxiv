import { ResultAsync } from '@openxiv/shared';
import type { ExtractedMetadata, GrobidExtractor } from './interface.js';

/**
 * Mock that returns plausible-looking metadata. Useful for tests and dev when
 * GROBID isn't running.
 */
export function makeMockGrobidExtractor(overrides: Partial<ExtractedMetadata> = {}): GrobidExtractor {
  return {
    extract() {
      const meta: ExtractedMetadata = {
        title: overrides.title ?? 'An Investigation Into Synthetic Test Phenomena',
        abstract:
          overrides.abstract ??
          'We present a stub abstract used for development and tests. ' +
            'It explains the goal of the paper at a high level so callers exercising ' +
            'the GROBID extraction path receive a structured response.',
        authors: overrides.authors ?? [{ displayName: 'Unknown' }],
        references:
          overrides.references ??
          ['Doe et al. (2024). Things and stuff. Journal of Things 12(3).'],
        bodyText:
          overrides.bodyText ??
          'This is the body text returned by the mock GROBID extractor for end-to-end testing.',
      };
      return ResultAsync.fromSafePromise(Promise.resolve(meta));
    },
  };
}
