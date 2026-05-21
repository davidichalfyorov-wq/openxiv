import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, openxivIdToUrl } from '@openxiv/shared';
import type { PaperRecord, RefusalExample, UserRecord } from '@openxiv/db';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export async function meSubmissionsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get(
    '/me/submissions',
    {
      preHandler: app.requireAuth,
      schema: { querystring: querySchema },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { limit } = req.query as { limit: number };
      const userResult = await ctx.repos.users.findById(req.session.uid);
      if (userResult.isErr()) throw userResult.error;
      if (!userResult.value) throw Errors.unauthorized();

      const dids = requesterSubmissionDids(req.session.did, userResult.value);
      const byId = new Map<string, PaperRecord>();
      for (const submitterDid of dids) {
        const listed = await ctx.repos.papers.list({ submitterDid, limit });
        if (listed.isErr()) throw listed.error;
        for (const paper of listed.value) byId.set(paper.id, paper);
      }

      const papers = [...byId.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
      const items = [];
      for (const paper of papers) {
        const refusal = await ctx.repos.refusals.getByPaperId(paper.id);
        if (refusal.isErr()) throw refusal.error;
        items.push({
          ...serializeSubmissionPaper(paper),
          feedback:
            refusal.value && !refusal.value.rescindedAt
              ? {
                  reasonCategory: refusal.value.reasonCategory,
                  fixable: refusal.value.fixable,
                  examples: refusal.value.examples as RefusalExample[],
                  moderatorNote: refusal.value.moderatorNote,
                  issuedByDid: refusal.value.issuedByDid,
                  issuedAt: refusal.value.issuedAt.toISOString(),
                }
              : null,
        });
      }

      return { identities: dids, items };
    },
  );
}

export function requesterSubmissionDids(sessionDid: string, user: UserRecord): string[] {
  return [
    sessionDid,
    user.did,
    user.blueskyDid,
    ...(Array.isArray(user.legacyDids) ? user.legacyDids : []),
  ].reduce<string[]>((acc, did) => {
    if (did && !acc.includes(did)) acc.push(did);
    return acc;
  }, []);
}

function serializeSubmissionPaper(paper: PaperRecord): Record<string, unknown> {
  return {
    id: paper.id,
    openxivId: paper.openxivId,
    openxivUrlId: paper.openxivId ? openxivIdToUrl(paper.openxivId) : null,
    uri: paper.uri,
    title: paper.title,
    abstract: paper.abstract,
    primaryCategory: paper.primaryCategory,
    crossListings: paper.crossListings ?? [],
    status: paper.status,
    publishedAt: paper.publishedAt?.toISOString() ?? null,
    createdAt: paper.createdAt.toISOString(),
    updatedAt: paper.updatedAt.toISOString(),
    submitterDid: paper.submitterDid,
  };
}
