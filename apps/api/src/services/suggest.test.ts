import { describe, expect, it } from 'vitest';
import { ResultAsync, parseEnv } from '@openxiv/shared';
import type { GenerateOptions, LlmClient } from '@openxiv/clients';
import type { AppContext } from '../context.js';
import type { IntakeRecord, IntakeService } from './intake.js';
import { makeSuggestService } from './suggest.js';

function makeEnv(overrides: Record<string, string | undefined> = {}) {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/openxiv',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'access-key',
    S3_SECRET_ACCESS_KEY: 'secret-key',
    S3_BUCKET: 'openxiv',
    SESSION_SECRET: 'dev-session-secret-please-replace-32-chars-min',
    JWT_SECRET: 'dev-jwt-secret-please-replace-32-chars-min',
    ...overrides,
  });
}

function makeRecord(): IntakeRecord {
  return {
    sessionId: 'intake-1',
    filename: 'paper.tex',
    sourceKey: 'intake/1/source-paper.tex',
    previewPdfKey: 'intake/1/preview.pdf',
    sha256: 'abc123',
    sizeBytes: 1024,
    extractedTitle: 'DeepSeek label mismatch',
    extractedAbstract: 'This paper explains a provider label mismatch.',
    extractedAuthors: [],
    extractedReferences: [],
    extractedBodyText: 'The summary service should use the configured text provider.',
    suggestedKeywords: [],
    grobidFailed: false,
    createdAt: new Date('2026-05-19T00:00:00Z').toISOString(),
  };
}

function makeIntakeService(record: IntakeRecord): IntakeService {
  return {
    intake() {
      throw new Error('not needed');
    },
    getSession() {
      return ResultAsync.fromSafePromise(Promise.resolve(record));
    },
  };
}

describe('makeSuggestService', () => {
  it('uses DeepSeek v4 flash when DeepSeek is the text provider', async () => {
    let seenOptions: GenerateOptions | undefined;
    const llm: LlmClient = {
      generateText(_prompt, options) {
        seenOptions = options;
        return ResultAsync.fromSafePromise(Promise.resolve(' Draft summary. '));
      },
      generateEmbedding() {
        return ResultAsync.fromSafePromise(Promise.resolve([]));
      },
    };
    const ctx = {
      env: makeEnv({
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_MODEL_TEXT: 'deepseek-v4-flash',
        GEMINI_API_KEY: 'gemini-key',
        GEMINI_MODEL_TEXT: 'gemini-2.5-flash',
      }),
      clients: { llm },
    } as AppContext;

    const result = await makeSuggestService(ctx, makeIntakeService(makeRecord())).forIntake({
      sessionId: 'intake-1',
      tier: 'undergrad',
    });

    expect(result.isOk()).toBe(true);
    expect(seenOptions?.model).toBe('deepseek-v4-flash');
    if (result.isOk()) {
      expect(result.value).toEqual({ text: 'Draft summary.', aiModel: 'deepseek-v4-flash' });
    }
  });

  it('logs the selected DeepSeek v4 flash suggest model on each call', async () => {
    let seenOptions: GenerateOptions | undefined;
    const infoCalls: Array<{ obj: unknown; msg: string }> = [];
    const llm: LlmClient = {
      generateText(_prompt, options) {
        seenOptions = options;
        return ResultAsync.fromSafePromise(Promise.resolve(' Draft summary. '));
      },
      generateEmbedding() {
        return ResultAsync.fromSafePromise(Promise.resolve([]));
      },
    };
    const ctx = {
      env: makeEnv({
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_MODEL_TEXT: '',
      }),
      clients: { llm },
    } as AppContext;

    const result = await makeSuggestService(ctx, makeIntakeService(makeRecord()), {
      info(obj, msg) {
        infoCalls.push({ obj, msg });
      },
    }).forIntake({
      sessionId: 'intake-1',
      tier: 'undergrad',
    });

    expect(result.isOk()).toBe(true);
    expect(seenOptions?.model).toBe('deepseek-v4-flash');
    expect(infoCalls).toEqual([
      {
        obj: { sessionId: 'intake-1', tier: 'undergrad', model: 'deepseek-v4-flash' },
        msg: 'suggest summary model selected',
      },
    ]);
  });
});
