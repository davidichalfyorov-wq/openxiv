import { Errors, type AppEnv, type AppResultAsync, ResultAsync } from '@openxiv/shared';
import { SUMMARY_PROMPTS } from '@openxiv/clients';
import type { AppContext } from '../context.js';
import type { IntakeService } from './intake.js';

export interface SuggestService {
  forIntake(input: {
    sessionId: string;
    tier: 'school' | 'undergrad' | 'expert';
  }): AppResultAsync<{ text: string; aiModel: string }>;
}

interface SuggestLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

const DEEPSEEK_SUGGEST_MODEL = 'deepseek-v4-flash';

function resolveSuggestTextModel(env: AppEnv): string {
  if (env.USE_MOCK_CLIENTS || env.USE_MOCK_LLM) return 'mock-llm';
  if (env.DEEPSEEK_API_KEY.length > 0) {
    return DEEPSEEK_SUGGEST_MODEL;
  }
  return 'mock-llm';
}

export function makeSuggestService(
  ctx: AppContext,
  intakeService: IntakeService,
  logger?: SuggestLogger,
): SuggestService {
  const { llm } = ctx.clients;
  const textModel = resolveSuggestTextModel(ctx.env);
  return {
    forIntake({ sessionId, tier }) {
      return intakeService.getSession(sessionId).andThen((record) => {
        if (!record) {
          return ResultAsync.fromPromise(Promise.reject(new Error('session gone')), () =>
            Errors.notFound(`intake session ${sessionId} not found or expired`),
          );
        }
        const corpus = [
          record.extractedTitle ?? '',
          record.extractedAbstract ?? '',
          record.extractedBodyText,
        ]
          .filter(Boolean)
          .join('\n\n');
        if (!corpus) {
          return ResultAsync.fromPromise(Promise.reject(new Error('no corpus')), () =>
            Errors.validation('intake produced no extractable text for suggestion'),
          );
        }
        const prompt = SUMMARY_PROMPTS[tier](corpus);
        logger?.info(
          { sessionId, tier, model: textModel },
          'suggest summary model selected',
        );
        // 4096 leaves headroom for reasoning-model intermediate trace
        // (deepseek-v4-flash, -pro) plus the final summary content.
        // 600 was the original budget tuned for Gemini's chat models
        // which do not emit a reasoning trace; on DeepSeek it caused
        // the entire budget to be consumed by the reasoning stage and
        // the summary content arrived empty, which tripped the breaker.
        return llm
          .generateText(prompt, { model: textModel, maxTokens: 4096 })
          .map((text) => ({ text: text.trim(), aiModel: textModel }));
      });
    },
  };
}
