import { createHash } from 'node:crypto';
import { AppError, Errors, fromPromise } from '@openxiv/shared';
import type { EmbedOptions, GenerateOptions, LlmClient } from './interface.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface DeepseekConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly textModel: string;
  readonly timeoutMs?: number;
  readonly embeddingFallback?: LlmClient;
  readonly embeddingDims?: number;
  readonly logger?: {
    warn(obj: Record<string, unknown>, msg: string): void;
  };
}

interface ChatCompletionResponse {
  // DeepSeek V4 is a reasoning model: it emits `reasoning_content`
  // (the internal think-step trace, often in Chinese) BEFORE the
  // final `content`. If max_tokens is reached during reasoning,
  // `content` ends up empty and `finish_reason === 'length'`.
  // Default max_tokens is bumped accordingly in generateText below.
  choices?: Array<{
    message?: { content?: string; reasoning_content?: string };
    finish_reason?: string;
  }>;
}

/**
 * DeepSeek chat client. The API is OpenAI-compatible, so we POST to
 * /chat/completions and read back `choices[0].message.content`.
 *
 * DeepSeek does NOT offer embedding models. `generateEmbedding` delegates to
 * `embeddingFallback` when provided, otherwise it returns a deterministic
 * hash-based vector so callers that only need a stable surrogate (e.g.
 * dedup, schema validation) continue to work without semantic search.
 *
 * When you wire up a real embedding provider (Gemini text-embedding-004,
 * OpenAI text-embedding-3-small, voyage-3, …), pass it as
 * `embeddingFallback` from the factory.
 */
export function makeDeepseekClient(cfg: DeepseekConfig): LlmClient {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const embeddingDims = cfg.embeddingDims ?? 768;

  return {
    generateText(prompt, options: GenerateOptions = {}) {
      const model = options.model ?? cfg.textModel;
      const messages: Array<{ role: string; content: string }> = [];
      if (options.system) messages.push({ role: 'system', content: options.system });
      messages.push({ role: 'user', content: prompt });

      const work = async (): Promise<string> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(`${cfg.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${cfg.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: options.temperature ?? 0.4,
              // 4096 leaves headroom for the reasoning trace plus the
              // final content on deepseek-v4-flash and deepseek-v4-pro.
              // With the old 1024 cap, reasoning consumed the budget
              // and content arrived empty, which tripped the breaker.
              max_tokens: options.maxTokens ?? 4096,
              stream: false,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw Errors.externalInvalidResponse('deepseek_http_error', {
            status: res.status,
            body: text.slice(0, 500),
          });
        }
        const data = (await res.json()) as ChatCompletionResponse;
        const choice = data.choices?.[0];
        const out = choice?.message?.content?.trim();
        if (out) return out;

        const reasoningOut = choice?.message?.reasoning_content?.trim();
        if (reasoningOut) return reasoningOut;

        const finish = choice?.finish_reason ?? 'unknown';
        if (finish === 'length') {
          throw Errors.externalInvalidResponse('deepseek_truncated', {
            finishReason: finish,
            model,
          });
        }
        throw Errors.externalInvalidResponse('deepseek_empty_content', {
          finishReason: finish,
          model,
        });
      };

      return fromPromise(work(), (cause) => {
        if (cause instanceof AppError) return cause;
        const causeMsg = cause instanceof Error ? cause.message : String(cause);
        cfg.logger?.warn(
          { model, err: causeMsg.slice(0, 800) },
          'deepseek.generateText failed',
        );
        return Errors.externalInvalidResponse('deepseek.generateText failed', {
          cause: causeMsg.slice(0, 800),
        });
      });
    },

    generateEmbedding(text, options: EmbedOptions = {}) {
      if (cfg.embeddingFallback) {
        return cfg.embeddingFallback.generateEmbedding(text, options);
      }
      const work = async (): Promise<number[]> => deterministicEmbedding(text, embeddingDims);
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('deepseek.generateEmbedding', cause),
      );
    },
  };
}

/**
 * Deterministic, content-addressed surrogate vector. Same text → same
 * vector → dedup still works and pgvector inserts succeed. NOT semantic:
 * two paraphrases produce completely different vectors. Replace with a
 * real embedding provider before relying on similarity search.
 */
function deterministicEmbedding(text: string, dims: number): number[] {
  const out = new Array<number>(dims);
  let seed = createHash('sha256').update(text).digest();
  for (let i = 0; i < dims; i++) {
    if (i > 0 && i % 32 === 0) {
      seed = createHash('sha256').update(seed).digest();
    }
    const byte = seed[i % 32]!;
    out[i] = (byte / 255) * 2 - 1;
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < dims; i++) out[i] = out[i]! / norm;
  return out;
}
