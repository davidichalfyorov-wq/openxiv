import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, generateTid } from '@openxiv/shared';
import { PREREG_ATTESTATION, preregRecordSchema } from '@openxiv/lexicons';

const createSchema = z.object({
  paperUri: z.string().optional(),
  title: z.string().max(500).optional(),
  primaryCategory: z.string().max(64).optional(),
  hypothesis: z.string().min(20).max(2000),
  methodPlan: z.string().min(40).max(8000),
  expectedOutcome: z.string().min(20).max(4000),
  attestation: z.literal(PREREG_ATTESTATION),
});

export async function preregRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  /** Register a study before data collection. Writes to PDS (mock OK) + Postgres mirror. */
  app.post(
    '/preregistrations',
    {
      preHandler: app.requireAuth,
      schema: { body: createSchema },
    },
    async (req, reply) => {
      if (!req.session) throw Errors.unauthorized();
      const body = req.body as z.infer<typeof createSchema>;

      const lexRecord = {
        $type: 'app.openxiv.prereg' as const,
        ...(body.paperUri ? { paperUri: body.paperUri } : {}),
        ...(body.title ? { title: body.title } : {}),
        ...(body.primaryCategory ? { primaryCategory: body.primaryCategory } : {}),
        hypothesis: body.hypothesis,
        methodPlan: body.methodPlan,
        expectedOutcome: body.expectedOutcome,
        registeredAt: new Date().toISOString(),
        attestation: PREREG_ATTESTATION,
      };
      const parsed = preregRecordSchema.safeParse(lexRecord);
      if (!parsed.success) {
        throw Errors.validation('prereg lexicon validation failed', parsed.error.issues);
      }

      // Write to PDS (mock by default — see clients/pds/mock).
      const writeRes = await ctx.clients.pds.putRecord({
        repo: req.session.did,
        collection: 'app.openxiv.prereg',
        rkey: generateTid(),
        record: parsed.data as Record<string, unknown>,
      });
      const uri = writeRes.isOk() ? writeRes.value.uri : null;
      const cid = writeRes.isOk() ? writeRes.value.cid : null;

      // Optional join to a paper row if the paperUri matches one in our DB.
      let paperId: string | null = null;
      if (body.paperUri) {
        const found = await ctx.repos.papers.findByUri(body.paperUri);
        if (found.isOk() && found.value) paperId = found.value.id;
      }

      const persisted = await ctx.repos.preregs.create({
        uri,
        cid,
        authorDid: req.session.did,
        paperId,
        paperUri: body.paperUri ?? null,
        title: body.title ?? null,
        primaryCategory: body.primaryCategory ?? null,
        hypothesis: body.hypothesis,
        methodPlan: body.methodPlan,
        expectedOutcome: body.expectedOutcome,
        attestation: PREREG_ATTESTATION,
        registeredAt: new Date(),
      });
      if (persisted.isErr()) throw persisted.error;

      reply.status(201);
      return {
        id: persisted.value.id,
        uri: persisted.value.uri,
        registeredAt: persisted.value.registeredAt.toISOString(),
      };
    },
  );

  app.get(
    '/profiles/:did/preregistrations',
    {
      schema: { params: z.object({ did: z.string() }) },
    },
    async (req) => {
      const { did } = req.params as { did: string };
      const result = await ctx.repos.preregs.listByAuthor(did);
      if (result.isErr()) throw result.error;
      return {
        items: result.value.map((p) => ({
          id: p.id,
          title: p.title,
          hypothesis: p.hypothesis,
          paperUri: p.paperUri,
          registeredAt: p.registeredAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    '/papers/:id/preregistrations',
    {
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const result = await ctx.repos.preregs.listByPaper(id);
      if (result.isErr()) throw result.error;
      return {
        items: result.value.map((p) => ({
          id: p.id,
          authorDid: p.authorDid,
          hypothesis: p.hypothesis,
          expectedOutcome: p.expectedOutcome,
          registeredAt: p.registeredAt.toISOString(),
        })),
      };
    },
  );
}
