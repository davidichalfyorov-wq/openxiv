import { Errors, fromPromise } from '@openxiv/shared';
import { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeoutRetry } from '../http.js';
import type { EmbedOptions, GenerateOptions, LlmClient } from './interface.js';

export interface GeminiConfig {
  readonly apiKey: string;
  readonly textModel: string;
  readonly embedModel: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /**
   * Truncate the embedding to this many dimensions via Matryoshka representation
   * (`outputDimensionality` API param). `gemini-embedding-001` returns 3072
   * dims by default; the OpenXiv pgvector schema is 768 so we always pass it.
   */
  readonly embedDimensions?: number;
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

interface EmbedResponse {
  embedding?: { values?: number[] };
}

/**
 * Minimal Gemini client. Uses the Generative Language REST API to keep
 * dependencies thin; switch to @google/generative-ai SDK later if streaming
 * or other features are needed.
 */
export function makeGeminiClient(cfg: GeminiConfig): LlmClient {
  const base = cfg.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  async function request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchWithTimeoutRetry(`${base}/${path}?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`gemini ${res.status}: ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  return {
    generateText(prompt, options: GenerateOptions = {}) {
      const model = options.model ?? cfg.textModel;
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens: options.maxTokens ?? 1024,
        },
        ...(options.system
          ? { systemInstruction: { role: 'system', parts: [{ text: options.system }] } }
          : {}),
      };
      const work = async (): Promise<string> => {
        const data = await request<GenerateContentResponse>(
          `models/${encodeURIComponent(model)}:generateContent`,
          body,
        );
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('gemini: no candidate text');
        return text;
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('gemini.generateText', cause),
      );
    },
    generateEmbedding(text, options: EmbedOptions = {}) {
      const model = options.model ?? cfg.embedModel;
      const body = {
        content: { parts: [{ text }] },
        ...(cfg.embedDimensions ? { outputDimensionality: cfg.embedDimensions } : {}),
      };
      const work = async (): Promise<number[]> => {
        const data = await request<EmbedResponse>(
          `models/${encodeURIComponent(model)}:embedContent`,
          body,
        );
        const vec = data.embedding?.values;
        if (!Array.isArray(vec) || vec.length === 0) throw new Error('gemini: empty embedding');
        return vec;
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('gemini.generateEmbedding', cause),
      );
    },
  };
}
