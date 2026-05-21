import { z } from 'zod';
import { Errors, ResultAsync, fromPromise, type AppResultAsync } from '@openxiv/shared';
import { REFUSAL_REASON_VALUES, type PaperRecord, type SagaStage } from '@openxiv/db';
import type { SessionPayload } from '../auth/session.js';
import type { AppContext } from '../context.js';
import type { Services } from './index.js';

export type ModerationRole = 'admin' | 'moderator';

export interface ModerationActor {
  userId: string;
  did: string;
  role: ModerationRole;
}

export const moderationDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accept') }),
  z.object({
    decision: z.literal('reject_conditionally'),
    reasonCategory: z.enum(REFUSAL_REASON_VALUES).default('other'),
    examples: z
      .array(
        z.object({
          section: z.string().max(100).optional(),
          problem: z.string().min(1).max(500),
          suggestion: z.string().max(500).optional(),
        }),
      )
      .max(20)
      .default([]),
    moderatorNote: z.string().min(1).max(4000),
  }),
  z.object({
    decision: z.literal('reject'),
    reasonCategory: z.enum(REFUSAL_REASON_VALUES).default('other'),
    examples: z
      .array(
        z.object({
          section: z.string().max(100).optional(),
          problem: z.string().min(1).max(500),
          suggestion: z.string().max(500).optional(),
        }),
      )
      .max(20)
      .default([]),
    moderatorNote: z.string().min(1).max(4000),
  }),
]);

export type ModerationDecision = z.input<typeof moderationDecisionSchema>;
type ParsedModerationDecision = z.output<typeof moderationDecisionSchema>;

export function shouldHoldForManualModeration(stage: SagaStage, alreadyApproved: boolean): boolean {
  return stage === 'stagePaperApproved' && !alreadyApproved;
}

export async function resolveModerationActor(
  services: Pick<Services, 'users'>,
  session?: SessionPayload,
): Promise<ModerationActor> {
  if (!session) throw Errors.unauthorized('sign in required');
  const user = await services.users.getById(session.uid);
  if (user.isErr()) throw Errors.unauthorized('sign in required');
  const role = user.value.role;
  if (role === 'admin' || role === 'moderator') {
    return { userId: user.value.id, did: user.value.did, role };
  }
  if (services.users.isAdminDid(user.value.did)) {
    return { userId: user.value.id, did: user.value.did, role: 'admin' };
  }
  throw Errors.forbidden('moderator or admin only');
}

export interface ModerationQueueItem {
  id: string;
  openxivId: string | null;
  title: string;
  abstract: string | null;
  primaryCategory: string;
  crossListings: string[];
  status: PaperRecord['status'];
  submitterDid: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: {
    id: string;
    versionNumber: number;
    pdfKey: string | null;
    htmlKey: string | null;
    sourceKey: string | null;
    fileSha256: string | null;
  } | null;
}

export function listPendingModeration(ctx: AppContext): AppResultAsync<ModerationQueueItem[]> {
  return ctx.repos.papers.list({ status: 'pending_review', limit: 100 }).andThen((papers) =>
    ctx.repos.papers.loadManyWithRelations(papers.map((p) => p.id)).map((loaded) =>
      loaded
        .filter((item) => item.paper.status === 'pending_review')
        .map((item) => ({
          id: item.paper.id,
          openxivId: item.paper.openxivId,
          title: item.paper.title,
          abstract: item.paper.abstract,
          primaryCategory: item.paper.primaryCategory,
          crossListings: item.paper.crossListings ?? [],
          status: item.paper.status,
          submitterDid: item.paper.submitterDid,
          createdAt: item.paper.createdAt.toISOString(),
          updatedAt: item.paper.updatedAt.toISOString(),
          latestVersion: item.latestVersion
            ? {
                id: item.latestVersion.id,
                versionNumber: item.latestVersion.versionNumber,
                pdfKey: item.latestVersion.pdfKey,
                htmlKey: item.latestVersion.htmlKey,
                sourceKey: item.latestVersion.sourceKey,
                fileSha256: item.latestVersion.fileSha256,
              }
            : null,
        })),
    ),
  );
}

export function applyModerationDecision(
  ctx: AppContext,
  input: {
    paperId: string;
    actorDid: string;
    decision: ModerationDecision;
  },
): AppResultAsync<{ paperId: string; decision: ParsedModerationDecision['decision'] }> {
  const decision = moderationDecisionSchema.parse(input.decision);
  return ctx.repos.papers.findById(input.paperId).andThen((paper) => {
    if (!paper) {
      return ResultAsync.fromPromise(Promise.reject(new Error('not found')), () =>
        Errors.notFound('paper'),
      );
    }
    switch (decision.decision) {
      case 'accept':
        return acceptPaper(ctx, paper).map(() => ({
          paperId: paper.id,
          decision: decision.decision,
        }));
      case 'reject_conditionally':
        return writeRefusal(ctx, paper, input.actorDid, decision, true, 'pending_review').map(
          () => ({
            paperId: paper.id,
            decision: decision.decision,
          }),
        );
      case 'reject':
        return writeRefusal(ctx, paper, input.actorDid, decision, false, 'withdrawn').map(() => ({
          paperId: paper.id,
          decision: decision.decision,
        }));
    }
  });
}

function acceptPaper(ctx: AppContext, paper: PaperRecord): AppResultAsync<void> {
  return ctx.repos.sagas.ensure(paper.id).andThen((saga) => {
    if (paper.status !== 'pending_review' || saga.stagePaperApproved) {
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    }

    return ctx.repos.papers.latestVersion(paper.id).andThen((version) => {
      if (!version?.sourceKey) {
        return ResultAsync.fromPromise(Promise.reject(new Error('missing version')), () =>
          Errors.conflict('compiled version required before acceptance'),
        );
      }
      const sourceKey = version.sourceKey;
      return ctx.repos.sagas
        .markStageDone(paper.id, 'stagePaperApproved')
        .andThen(() =>
          ctx.repos.refusals
            .rescind(paper.id)
            .orElse(() => ResultAsync.fromSafePromise(Promise.resolve(undefined))),
        )
        .andThen(() =>
          fromPromise(
            ctx.queues.compile.add(
              'submit-saga',
              {
                paperId: paper.id,
                sourceKey,
                filename: filenameFromSourceKey(sourceKey),
              },
              {
                attempts: 5,
                backoff: { type: 'exponential', delay: 30_000 },
                removeOnComplete: { count: 50, age: 3_600 * 24 * 7 },
                removeOnFail: { count: 200, age: 3_600 * 24 * 30 },
                jobId: `saga-${paper.id}-moderation-accept`,
              },
            ),
            (cause) => Errors.internal('moderation accept enqueue', cause),
          ).map(() => undefined),
        );
    });
  });
}

function writeRefusal(
  ctx: AppContext,
  paper: PaperRecord,
  actorDid: string,
  decision: Extract<ParsedModerationDecision, { decision: 'reject' | 'reject_conditionally' }>,
  fixable: boolean,
  status: 'pending_review' | 'withdrawn',
): AppResultAsync<void> {
  return ctx.repos.refusals
    .upsert({
      paperId: paper.id,
      reasonCategory: decision.reasonCategory,
      fixable,
      examples: decision.examples,
      moderatorNote: decision.moderatorNote,
      issuedByDid: actorDid,
    })
    .andThen(() => ctx.repos.papers.setStatus(paper.id, status));
}

function filenameFromSourceKey(sourceKey?: string | null): string {
  const leaf = sourceKey?.split('/').pop();
  if (!leaf) return 'main.tex';
  return leaf.startsWith('source-') && leaf.length > 'source-'.length
    ? leaf.slice('source-'.length)
    : 'main.tex';
}
