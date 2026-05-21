import { describe, expect, it } from 'vitest';
import { ResultAsync, parseEnv } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import { makeSubmissionsService } from './submissions.js';

const longText = (label: string) =>
  `${label} `.repeat(18).trim() +
  ' with enough detail to pass the submission summary length gate.';

function ok<T>(value: T) {
  return ResultAsync.fromSafePromise(Promise.resolve(value));
}

function makeEnv() {
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
  });
}

function makeFinalizeCtx() {
  const persistedSummaries: Array<{
    paperId: string;
    tier: 'school' | 'undergrad' | 'expert';
    text: string;
    aiGenerated: boolean;
    aiModel?: string;
  }> = [];
  let persistedDisclosure: { summaryAiGenerated?: boolean } | null = null;
  const compileJobs: Array<{
    name: string;
    data: unknown;
    options: Record<string, unknown>;
  }> = [];

  const ctx = {
    env: makeEnv(),
    redis: {
      get: async () =>
        JSON.stringify({
          sourceKey: 'intake/session-1/source-paper.tex',
          previewPdfKey: 'intake/session-1/preview.pdf',
          filename: 'paper.tex',
          sha256: 'abc123',
          sizeBytes: 1024,
        }),
      del: async () => 1,
    },
    clients: {
      storage: {
        get: () => ok({ body: Buffer.from('\\documentclass{article}'), contentType: 'text/x-tex' }),
        put: () => ok(undefined),
      },
    },
    queues: {
      compile: {
        add: async (name: string, data: unknown, options: Record<string, unknown>) => {
          compileJobs.push({ name, data, options });
          return { id: 'saga-paper-1' };
        },
      },
    },
    repos: {
      idAllocator: {},
      papers: {
        create: () => ok({ id: 'paper-1' }),
        setCategories: () => ok(undefined),
        setAuthors: () => ok(undefined),
        setKeywords: () => ok(undefined),
        upsertDisclosure: (input: { summaryAiGenerated?: boolean }) => {
          persistedDisclosure = input;
          return ok({
            id: 'disclosure-1',
            paperId: 'paper-1',
            ...input,
            createdAt: new Date('2026-05-19T00:00:00Z'),
          });
        },
        upsertSummary: (input: {
          paperId: string;
          tier: 'school' | 'undergrad' | 'expert';
          text: string;
          aiGenerated: boolean;
          aiModel?: string;
        }) => {
          persistedSummaries.push(input);
          return ok({
            id: `summary-${input.tier}`,
            uri: null,
            createdAt: new Date('2026-05-19T00:00:00Z'),
            aiModel: input.aiModel ?? null,
            ...input,
          });
        },
      },
      sagas: {
        ensure: () => ok({ paperId: 'paper-1' }),
      },
    },
  } as unknown as AppContext;

  return { ctx, persistedSummaries, getDisclosure: () => persistedDisclosure, compileJobs };
}

function finalizeInput(overrides: Record<string, unknown> = {}) {
  return {
    submitterDid: 'did:plc:author123',
    sessionId: 'session-1',
    title: 'Three tier summaries in the submission pipeline',
    abstract: 'A test paper about preserving tiered summaries.',
    license: 'CC-BY-4.0',
    primaryCategory: 'cs.AI',
    secondaryCategories: [],
    authors: [{ displayName: 'A. Author', isCorresponding: true }],
    keywords: ['summaries'],
    disclosure: {
      level: 'assistant',
      aiUsed: ['summary'],
      models: [{ name: 'deepseek-v4-flash' }],
      summaryAiGenerated: true,
      attestation: 'i-attest-this-disclosure-is-accurate',
    },
    submissionTermsVersion: '2026-05-18',
    summaries: [
      {
        tier: 'school',
        text: longText('School tier keeps analogies and avoids jargon.'),
        aiGenerated: true,
        aiModel: 'deepseek-v4-flash',
      },
      {
        tier: 'undergrad',
        text: longText('Undergrad tier names methods and prerequisites.'),
        aiGenerated: true,
        aiModel: 'deepseek-v4-flash',
      },
      {
        tier: 'expert',
        text: longText('Expert tier preserves assumptions limitations and technical claims.'),
        aiGenerated: true,
        aiModel: 'deepseek-v4-flash',
      },
    ],
    ...overrides,
  };
}

describe('makeSubmissionsService multi-tier summaries', () => {
  it('persists all submitted explainer tiers from the intake finalize pipeline', async () => {
    const { ctx, persistedSummaries, getDisclosure } = makeFinalizeCtx();

    const result = await makeSubmissionsService(ctx).finalizeFromIntake(
      finalizeInput() as never,
    );

    expect(result.isOk()).toBe(true);
    expect(persistedSummaries).toHaveLength(3);
    expect(persistedSummaries.map((s) => s.tier)).toEqual([
      'school',
      'undergrad',
      'expert',
    ]);
    expect(persistedSummaries.every((s) => s.aiGenerated)).toBe(true);
    expect(persistedSummaries.every((s) => s.aiModel === 'deepseek-v4-flash')).toBe(true);
    expect(persistedSummaries[0]?.text).toContain('School tier');
    expect(persistedSummaries[1]?.text).toContain('Undergrad tier');
    expect(persistedSummaries[2]?.text).toContain('Expert tier');
    expect(getDisclosure()?.summaryAiGenerated).toBe(true);
  });

  it('enqueues finalize saga with retries so transient compile failures can recover', async () => {
    const { ctx, compileJobs } = makeFinalizeCtx();

    const result = await makeSubmissionsService(ctx).finalizeFromIntake(
      finalizeInput() as never,
    );

    expect(result.isOk()).toBe(true);
    expect(compileJobs).toHaveLength(1);
    expect(compileJobs[0]).toMatchObject({
      name: 'submit-saga',
      data: { paperId: 'paper-1', sourceKey: 'papers/paper-1/v1/source-paper.tex' },
      options: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        jobId: 'saga-paper-1',
      },
    });
  });

  it('rejects AI-generated summaries that are not disclosed as AI summary work', async () => {
    const { ctx, persistedSummaries } = makeFinalizeCtx();

    const result = await makeSubmissionsService(ctx).finalizeFromIntake(
      finalizeInput({
        disclosure: {
          level: 'none',
          aiUsed: [],
          models: [],
          summaryAiGenerated: false,
          attestation: 'i-attest-this-disclosure-is-accurate',
        },
      }) as never,
    );

    expect(result.isErr()).toBe(true);
    expect(persistedSummaries).toHaveLength(0);
  });
});
