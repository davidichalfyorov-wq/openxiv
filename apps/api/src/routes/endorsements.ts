import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, generateTid, parseOpenxivId } from '@openxiv/shared';
import {
  ENDORSEMENT_LEX_ID,
  ENDORSEMENT_VERBS,
  endorsementRecordSchema,
  endorsementVerbSchema,
} from '@openxiv/lexicons';
import { putAtProtoRecord } from '../services/atproto-writer.js';
import { invalidateEngagementCache } from '../services/engagement-stats.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const verbFilterSchema = z.object({
  verb: endorsementVerbSchema.optional(),
});

const endorsementInputSchema = z.object({
  paperId: z.string().min(1),
  verb: endorsementVerbSchema,
  note: z.string().max(500).optional(),
});

interface RequesterIdentity {
  did?: string | null;
  blueskyDid?: string | null;
  legacyDids?: readonly string[] | null;
}

interface PaperEndorsementIdentity {
  submitterDid: string;
  authors: Array<{ did: string | null }>;
}

export function requesterDids(sessionDid: string, user: RequesterIdentity | null): Set<string> {
  const dids = new Set<string>([sessionDid]);
  if (user?.did) dids.add(user.did);
  if (user?.blueskyDid) dids.add(user.blueskyDid);
  for (const did of user?.legacyDids ?? []) {
    if (did) dids.add(did);
  }
  return dids;
}

export function isOwnPaperForEndorsement(
  identity: PaperEndorsementIdentity,
  dids: ReadonlySet<string>,
): boolean {
  if (dids.has(identity.submitterDid)) return true;
  return identity.authors.some((author) => Boolean(author.did && dids.has(author.did)));
}

export async function endorsementsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  /**
   * Public list of endorsements on a paper, optionally filtered by verb.
   * Returns the typed records without revealing the endorser's note when
   * the field is empty. Pagination cap is intentionally high (the typical
   * paper will accumulate dozens, not thousands).
   */
  app.get(
    '/papers/:id/endorsements',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: verbFilterSchema,
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { verb } = req.query as z.infer<typeof verbFilterSchema>;
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const r = await ctx.repos.endorsements.forPaper(paperRow.id, verb ? { verb } : undefined);
      if (r.isErr()) throw r.error;
      const stats = await ctx.repos.endorsements.statsForPaper(paperRow.id);
      return {
        items: r.value.map((e) => ({
          id: e.id,
          uri: e.uri,
          endorserDid: e.endorserDid,
          verb: e.verb,
          note: e.note,
          createdAt: e.createdAt.toISOString(),
        })),
        stats: stats.isOk()
          ? {
              total: stats.value.total,
              distinctVerbs: stats.value.distinctVerbs,
              byVerb: stats.value.byVerb,
            }
          : { total: 0, distinctVerbs: 0, byVerb: {} as Record<string, number> },
        verbs: ENDORSEMENT_VERBS,
      };
    },
  );

  /**
   * Create or update the requester's endorsement on a paper. Auth-only.
   * Verb is required; the same user can re-submit to change verb or note.
   * Authors cannot endorse their own paper — that would be a vanity signal,
   * not community validation.
   */
  app.post(
    '/papers/:id/endorsements',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: endorsementInputSchema.omit({ paperId: true }),
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const body = req.body as { verb: z.infer<typeof endorsementVerbSchema>; note?: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const userResult = await ctx.repos.users.findById(req.session.uid);
      if (userResult.isErr()) throw userResult.error;
      const paperWithRelations = await ctx.repos.papers.loadWithRelations(paperRow.id);
      if (paperWithRelations.isErr()) throw paperWithRelations.error;
      if (!paperWithRelations.value) throw Errors.notFound('paper');
      const dids = requesterDids(req.session.did, userResult.value);
      if (
        isOwnPaperForEndorsement(
          {
            submitterDid: paperWithRelations.value.paper.submitterDid,
            authors: paperWithRelations.value.authors,
          },
          dids,
        )
      ) {
        throw Errors.forbidden('authors cannot endorse their own paper');
      }
      const endorserDid = userResult.value?.blueskyDid ?? req.session.did;
      const tid = generateTid();
      let uri = `at://${endorserDid}/${ENDORSEMENT_LEX_ID}/${tid}`;
      if (paperRow.uri) {
        const record = {
          paperUri: paperRow.uri,
          verb: body.verb,
          ...(body.note ? { note: body.note } : {}),
          createdAt: new Date().toISOString(),
        };
        const parsed = endorsementRecordSchema.safeParse(record);
        if (parsed.success) {
          const written = await putAtProtoRecord(ctx, {
            repo: endorserDid,
            collection: ENDORSEMENT_LEX_ID,
            rkey: tid,
            record: parsed.data as Record<string, unknown>,
          });
          if (written.isOk()) uri = written.value.uri;
        }
      }
      const upserted = await ctx.repos.endorsements.upsert({
        uri,
        paperId: paperRow.id,
        endorserDid,
        verb: body.verb,
        note: body.note ?? null,
      });
      if (upserted.isErr()) throw upserted.error;
      await invalidateEngagementCache(ctx, paperRow.id);
      return {
        id: upserted.value.id,
        uri: upserted.value.uri,
        verb: upserted.value.verb,
        note: upserted.value.note,
        createdAt: upserted.value.createdAt.toISOString(),
      };
    },
  );

  /** Remove the requester's endorsement on a paper. */
  app.delete(
    '/papers/:id/endorsements/mine',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const r = await ctx.repos.endorsements.remove(paperRow.id, req.session.did);
      if (r.isErr()) throw r.error;
      await invalidateEngagementCache(ctx, paperRow.id);
      return { ok: true };
    },
  );

  async function resolvePaper(
    id: string,
  ): Promise<{ id: string; submitterDid: string; uri: string | null } | null> {
    if (UUID_REGEX.test(id)) {
      const row = await ctx.repos.papers.findById(id);
      if (row.isErr()) throw row.error;
      return row.value;
    }
    const parsed = parseOpenxivId(id);
    if (!parsed) return null;
    const canonical = `openxiv:${parsed.subject}.${parsed.year}.${String(parsed.seq).padStart(5, '0')}`;
    const row = await ctx.repos.papers.findByOpenxivId(canonical);
    if (row.isErr()) throw row.error;
    return row.value;
  }
}
