import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import {
  applyModerationDecision,
  moderationDecisionSchema,
  resolveModerationActor,
  shouldHoldForManualModeration,
} from './moderation.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));

function user(role: 'author' | 'moderator' | 'admin') {
  return {
    id: `${role}-user`,
    did: `did:web:openxiv.test:u:${role}`,
    role,
  };
}

describe('resolveModerationActor', () => {
  it('allows current DB admin and moderator users', async () => {
    for (const role of ['admin', 'moderator'] as const) {
      const services = {
        users: {
          getById: vi.fn(() => okAsync(user(role))),
          isAdminDid: vi.fn(() => false),
        },
      };

      await expect(
        resolveModerationActor(services as never, {
          uid: `${role}-user`,
          did: `did:web:openxiv.test:u:${role}`,
          role: 'author',
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
      ).resolves.toMatchObject({ role });
    }
  });

  it('denies authors even when a stale signed session claims moderator', async () => {
    const services = {
      users: {
        getById: vi.fn(() => okAsync(user('author'))),
        isAdminDid: vi.fn(() => false),
      },
    };

    await expect(
      resolveModerationActor(services as never, {
        uid: 'author-user',
        did: 'did:web:openxiv.test:u:author',
        role: 'moderator',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('shouldHoldForManualModeration', () => {
  it('holds the saga at the approval stage until a moderator accepts', () => {
    expect(shouldHoldForManualModeration('stagePaperApproved', false)).toBe(true);
    expect(shouldHoldForManualModeration('stagePaperApproved', true)).toBe(false);
    expect(shouldHoldForManualModeration('stagePaperPersisted', false)).toBe(false);
  });
});

describe('moderationDecisionSchema', () => {
  it('requires moderator comments for conditional rejection and final rejection', () => {
    expect(moderationDecisionSchema.safeParse({ decision: 'reject_conditionally' }).success).toBe(
      false,
    );
    expect(moderationDecisionSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(
      moderationDecisionSchema.safeParse({
        decision: 'reject_conditionally',
        moderatorNote: 'Please upload a revised version addressing the citation problems.',
      }).success,
    ).toBe(true);
  });
});

describe('applyModerationDecision', () => {
  it('accept marks the approval stage done and resumes the saga', async () => {
    const calls: string[] = [];
    const ctx = {
      repos: {
        papers: {
          findById: vi.fn(() =>
            okAsync({
              id: 'paper-1',
              submitterDid: 'did:web:openxiv.test:u:author',
              status: 'pending_review',
            }),
          ),
          latestVersion: vi.fn(() =>
            okAsync({
              sourceKey: 'papers/paper-1/v1/source-main.tex',
            }),
          ),
          setStatus: vi.fn(() => okAsync(undefined)),
        },
        sagas: {
          ensure: vi.fn(() => okAsync({ paperId: 'paper-1', stagePaperApproved: false })),
          markStageDone: vi.fn((_paperId: string, stage: string) => {
            calls.push(`mark:${stage}`);
            return okAsync(undefined);
          }),
        },
        refusals: {
          rescind: vi.fn(() => okAsync(undefined)),
          upsert: vi.fn(),
        },
      },
      queues: {
        compile: {
          add: vi.fn(() => {
            calls.push('enqueue');
            return Promise.resolve();
          }),
        },
      },
    };

    const result = await applyModerationDecision(ctx as never, {
      paperId: 'paper-1',
      actorDid: 'did:web:openxiv.test:u:moderator',
      decision: { decision: 'accept' },
    });

    expect(result.isOk()).toBe(true);
    expect(calls).toEqual(['mark:stagePaperApproved', 'enqueue']);
    expect(ctx.queues.compile.add).toHaveBeenCalledWith(
      'submit-saga',
      expect.objectContaining({ paperId: 'paper-1' }),
      expect.objectContaining({ jobId: 'saga-paper-1-moderation-accept' }),
    );
    expect(ctx.repos.refusals.upsert).not.toHaveBeenCalled();
  });

  it('accept is idempotent after the approval stage is already marked', async () => {
    const ctx = {
      repos: {
        papers: {
          findById: vi.fn(() =>
            okAsync({
              id: 'paper-1',
              submitterDid: 'did:web:openxiv.test:u:author',
              status: 'pending_review',
            }),
          ),
          latestVersion: vi.fn(() =>
            okAsync({
              sourceKey: 'papers/paper-1/v1/source-main.tex',
            }),
          ),
        },
        sagas: {
          ensure: vi.fn(() => okAsync({ paperId: 'paper-1', stagePaperApproved: true })),
          markStageDone: vi.fn(() => okAsync(undefined)),
        },
        refusals: {
          rescind: vi.fn(() => okAsync(undefined)),
          upsert: vi.fn(),
        },
      },
      queues: {
        compile: {
          add: vi.fn(() => Promise.resolve()),
        },
      },
    };

    const result = await applyModerationDecision(ctx as never, {
      paperId: 'paper-1',
      actorDid: 'did:web:openxiv.test:u:moderator',
      decision: { decision: 'accept' },
    });

    expect(result.isOk()).toBe(true);
    expect(ctx.repos.sagas.markStageDone).not.toHaveBeenCalled();
    expect(ctx.queues.compile.add).not.toHaveBeenCalled();
  });

  it('accept refuses to resume publishing before a compiled version exists', async () => {
    const ctx = {
      repos: {
        papers: {
          findById: vi.fn(() =>
            okAsync({
              id: 'paper-1',
              submitterDid: 'did:web:openxiv.test:u:author',
              status: 'pending_review',
            }),
          ),
          latestVersion: vi.fn(() => okAsync(null)),
        },
        sagas: {
          ensure: vi.fn(() => okAsync({ paperId: 'paper-1', stagePaperApproved: false })),
          markStageDone: vi.fn(() => okAsync(undefined)),
        },
        refusals: {
          rescind: vi.fn(() => okAsync(undefined)),
          upsert: vi.fn(),
        },
      },
      queues: {
        compile: {
          add: vi.fn(() => Promise.resolve()),
        },
      },
    };

    const result = await applyModerationDecision(ctx as never, {
      paperId: 'paper-1',
      actorDid: 'did:web:openxiv.test:u:moderator',
      decision: { decision: 'accept' },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('conflict');
    expect(ctx.repos.sagas.markStageDone).not.toHaveBeenCalled();
    expect(ctx.queues.compile.add).not.toHaveBeenCalled();
  });

  it('conditional rejection stores a fixable refusal packet and does not resume publishing', async () => {
    const ctx = {
      repos: {
        papers: {
          findById: vi.fn(() =>
            okAsync({
              id: 'paper-1',
              submitterDid: 'did:web:openxiv.test:u:author',
              status: 'pending_review',
            }),
          ),
          setStatus: vi.fn(() => okAsync(undefined)),
        },
        sagas: {
          ensure: vi.fn(),
          markStageDone: vi.fn(),
        },
        refusals: {
          upsert: vi.fn(() => okAsync({ paperId: 'paper-1' })),
          rescind: vi.fn(),
        },
      },
      queues: { compile: { add: vi.fn() } },
    };

    const result = await applyModerationDecision(ctx as never, {
      paperId: 'paper-1',
      actorDid: 'did:web:openxiv.test:u:moderator',
      decision: {
        decision: 'reject_conditionally',
        moderatorNote: 'Revise the proof of Lemma 2 and upload a new version.',
        reasonCategory: 'other',
      },
    });

    expect(result.isOk()).toBe(true);
    expect(ctx.repos.refusals.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        paperId: 'paper-1',
        fixable: true,
        moderatorNote: 'Revise the proof of Lemma 2 and upload a new version.',
      }),
    );
    expect(ctx.repos.papers.setStatus).toHaveBeenCalledWith('paper-1', 'pending_review');
    expect(ctx.repos.sagas.markStageDone).not.toHaveBeenCalled();
    expect(ctx.queues.compile.add).not.toHaveBeenCalled();
  });

  it('final rejection stores a terminal refusal packet and withdraws the paper', async () => {
    const ctx = {
      repos: {
        papers: {
          findById: vi.fn(() =>
            okAsync({
              id: 'paper-1',
              submitterDid: 'did:web:openxiv.test:u:author',
              status: 'pending_review',
            }),
          ),
          setStatus: vi.fn(() => okAsync(undefined)),
        },
        sagas: {
          ensure: vi.fn(),
          markStageDone: vi.fn(),
        },
        refusals: {
          upsert: vi.fn(() => okAsync({ paperId: 'paper-1' })),
          rescind: vi.fn(),
        },
      },
      queues: { compile: { add: vi.fn() } },
    };

    const result = await applyModerationDecision(ctx as never, {
      paperId: 'paper-1',
      actorDid: 'did:web:openxiv.test:u:admin',
      decision: {
        decision: 'reject',
        moderatorNote: 'This is not a scientific manuscript.',
        reasonCategory: 'scope',
      },
    });

    expect(result.isOk()).toBe(true);
    expect(ctx.repos.refusals.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        paperId: 'paper-1',
        fixable: false,
        reasonCategory: 'scope',
      }),
    );
    expect(ctx.repos.papers.setStatus).toHaveBeenCalledWith('paper-1', 'withdrawn');
    expect(ctx.queues.compile.add).not.toHaveBeenCalled();
  });
});
