import type { AppResultAsync } from '@openxiv/shared';

export interface GenerateOptions {
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly system?: string;
}

export interface EmbedOptions {
  readonly model?: string;
}

export interface LlmClient {
  generateText(prompt: string, options?: GenerateOptions): AppResultAsync<string>;
  generateEmbedding(text: string, options?: EmbedOptions): AppResultAsync<number[]>;
}
