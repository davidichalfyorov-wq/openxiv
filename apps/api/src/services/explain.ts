import {
  Errors,
  type AppResultAsync,
  ResultAsync,
  TOKEN_LIMITS,
  estimateTokens,
} from '@openxiv/shared';
import { EXPLAIN_PROMPTS } from '@openxiv/clients';
import type { SummaryTier } from '@openxiv/db';
import type { AppContext } from '../context.js';
import { bumpAndCheckPerUserDaily, makeLlmBudget } from './llm-budget.js';

export interface ExplainService {
  explain(input: {
    paperId: string;
    tier: SummaryTier;
    userId?: string | null;
  }): AppResultAsync<{
    tier: SummaryTier;
    text: string;
    model: string;
    cached: boolean;
  }>;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function makeExplainService(ctx: AppContext): ExplainService {
  const { papers } = ctx.repos;
  const { llm, storage } = ctx.clients;
  const budget = makeLlmBudget(ctx);

  return {
    explain(input) {
      return papers.loadWithRelations(input.paperId).andThen((loaded) => {
        if (!loaded) {
          return ResultAsync.fromPromise(Promise.reject(new Error('not found')), () =>
            Errors.notFound('paper'),
          );
        }
        // Cache hit doesn't count toward per-user daily quota or token budget.
        const cached = loaded.summaries.find((s) => s.tier === input.tier);
        if (cached && Date.now() - cached.createdAt.getTime() < CACHE_TTL_MS) {
          return ResultAsync.fromSafePromise(
            Promise.resolve({
              tier: cached.tier,
              text: cached.text,
              model: cached.aiModel ?? 'cache',
              cached: true,
            }),
          );
        }

        // Cache miss → going to actually invoke the model. Apply the gates.
        const gate = input.userId
          ? ResultAsync.fromPromise(
              bumpAndCheckPerUserDaily(
                ctx.redis,
                'explain',
                input.userId,
                ctx.env.LLM_EXPLAIN_PER_USER_DAILY,
              ),
              (cause) => Errors.internal('explain.quota', cause),
            ).andThen((q) => {
              if (!q.allowed) {
                return ResultAsync.fromPromise(
                  Promise.reject(new Error('quota')),
                  () =>
                    Errors.rateLimited(
                      `explain quota exceeded for today: ${q.count}/${q.cap}`,
                    ),
                );
              }
              return ResultAsync.fromSafePromise(Promise.resolve(undefined));
            })
          : ResultAsync.fromSafePromise(Promise.resolve(undefined));

        const htmlKey = loaded.latestVersion?.htmlKey;
        const corpusFetch = htmlKey
          ? storage.get(htmlKey).map((o) => o.body.toString('utf8'))
          : ResultAsync.fromSafePromise(
              Promise.resolve(loaded.paper.abstract ?? loaded.paper.title),
            );

        return gate
          .andThen(() => corpusFetch)
          .andThen((rawCorpus) => {
            const corpus = capTextForExplain(stripHtml(rawCorpus));
            const prompt = EXPLAIN_PROMPTS[input.tier](corpus);
            // Pre-flight budget check: refuse before invoking the model if
            // the budget cap would be breached, so a failed call doesn't
            // burn quota for nothing.
            return budget.consume('text', estimateTokens(prompt) + 800 /* maxTokens */).andThen(
              () =>
                llm.generateText(prompt, {
                  model: ctx.env.GEMINI_MODEL_TEXT,
                  maxTokens: 800,
                }),
            );
          })
          .andThen((text) =>
            papers
              .upsertSummary({
                paperId: loaded.paper.id,
                tier: input.tier,
                text,
                aiGenerated: true,
                aiModel: ctx.env.GEMINI_MODEL_TEXT,
              })
              .map((row) => ({
                tier: row.tier,
                text: row.text,
                model: row.aiModel ?? ctx.env.GEMINI_MODEL_TEXT,
                cached: false,
              })),
          );
      });
    },
  };
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Hard cap on prompt corpus size — the prompt templates already truncate
 * internally, but doing the cap here too gives us a single token-budgeted
 * value to send to `budget.consume`.
 */
function capTextForExplain(text: string): string {
  const limit = TOKEN_LIMITS.geminiTextSafe;
  if (estimateTokens(text) <= limit) return text;
  // Use a char-based cut here — close enough since this is post-strip plain text.
  return text.slice(0, limit * 4) + '\n[truncated]';
}
