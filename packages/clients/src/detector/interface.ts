import type { AppResultAsync } from '@openxiv/shared';

export interface DetectorScore {
  /** Composite score 0..100; 100 = strongly AI-generated. */
  readonly score: number;
  readonly burstScore: number;
  readonly binocularsScore: number;
  readonly stylometricScore: number;
  readonly modelVersions: Record<string, string>;
}

export interface DetectorWeights {
  readonly burst: number;
  readonly binoculars: number;
  readonly stylometric: number;
}

export interface AiDetector {
  score(text: string, weights: DetectorWeights): AppResultAsync<DetectorScore>;
}
