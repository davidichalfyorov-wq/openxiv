import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { PROFILE_MODES, type ProfileMode } from '@openxiv/db';
import { profileAiPolicySchema } from '@openxiv/lexicons';

const modeBodySchema = z.object({
  mode: z.enum(PROFILE_MODES),
  enabled: z.boolean(),
  public: z.boolean(),
});

const aiPolicySchema = profileAiPolicySchema.omit({ $type: true });

const readingGuideSchema = z.object({
  prerequisites: z.string().max(2000).optional(),
  start_here: z.string().max(2000).optional(),
  avoid_starting_with: z.string().max(2000).optional(),
  common_pitfalls: z.string().max(2000).optional(),
});

const CARD_TYPES = ['ai_policy', 'reading_guide'] as const;

export async function profileSettingsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  /**
   * GET /api/me/profile — combined view of the current user's modes + cards.
   * The /settings/profile UI editor renders from this. Always reads the
   * canonical row in the DB, never a cache; ops can tail logs to see who's
   * editing what.
   */
  app.get(
    '/me/profile',
    { preHandler: app.requireAuth },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      // Session JWT carries `uid` (the user UUID) directly. Avoid a
      // session.did → user_id DB lookup: after an account-link rotates
      // the primary DID (e.g. did:web → did:plc when Bluesky is linked),
      // the cookie still holds the old DID, and findByDid would 404 the
      // user from their own settings.
      const userId = req.session.uid;
      const [modesR, cardsR] = await Promise.all([
        ctx.repos.profileModes.forUser(userId),
        ctx.repos.profileCards.forUser(userId),
      ]);
      if (modesR.isErr()) throw modesR.error;
      if (cardsR.isErr()) throw cardsR.error;
      return {
        modes: modesR.value.map((m) => ({
          mode: m.mode,
          enabled: m.enabled,
          public: m.public,
          configJson: m.configJson,
          updatedAt: m.updatedAt.toISOString(),
        })),
        cards: Object.fromEntries(
          Object.entries(cardsR.value).map(([k, v]) => [
            k,
            { cardType: v.cardType, content: v.contentJson, updatedAt: v.updatedAt.toISOString() },
          ]),
        ),
      };
    },
  );

  /** PATCH a single mode for the current user. */
  app.patch(
    '/me/profile/modes',
    { preHandler: app.requireAuth, schema: { body: modeBodySchema } },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const userId = req.session.uid;
      const body = modeBodySchema.parse(req.body);
      const r = await ctx.repos.profileModes.upsert({
        userId,
        mode: body.mode as ProfileMode,
        enabled: body.enabled,
        public: body.public,
      });
      if (r.isErr()) throw r.error;
      return { mode: r.value.mode, enabled: r.value.enabled, public: r.value.public };
    },
  );

  /** PUT card content (ai_policy or reading_guide). */
  app.put(
    '/me/profile/cards/:cardType',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ cardType: z.enum(CARD_TYPES) }) },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const userId = req.session.uid;
      const { cardType } = req.params as { cardType: 'ai_policy' | 'reading_guide' };
      const parsed =
        cardType === 'ai_policy'
          ? aiPolicySchema.parse(req.body)
          : readingGuideSchema.parse(req.body);
      const r = await ctx.repos.profileCards.upsert({
        userId,
        cardType,
        content: parsed as Record<string, unknown>,
      });
      if (r.isErr()) throw r.error;
      return { cardType: r.value.cardType, content: r.value.contentJson };
    },
  );

  /** Public read of a user's profile modes + cards, for /u/{handle} SSR. */
  app.get(
    '/profiles/:did/extras',
    { schema: { params: z.object({ did: z.string().min(1).max(200) }) } },
    async (req) => {
      const { did } = req.params as { did: string };
      // Use findByAnyDid so legacy / rotated DIDs still resolve. A
      // viewer who has the old `did:web:openxiv.local:…` cached in a
      // bookmark, a PDS record, or an arXiv-side link should still
      // reach the right profile after migration to canonical DIDs.
      const user = await services.users.findByAnyDid(did);
      if (user.isErr() || !user.value) throw Errors.notFound('user');
      const [modesR, cardsR] = await Promise.all([
        ctx.repos.profileModes.publicForUser(user.value.id),
        ctx.repos.profileCards.forUser(user.value.id),
      ]);
      const modes = modesR.isOk() ? modesR.value.map((m) => m.mode) : [];
      const cards = cardsR.isOk() ? cardsR.value : {};
      // Only publicly emit cards whose underlying mode is public (Author /
      // Reviewer / Reader). Reading guide attaches to reading; AI policy
      // attaches to authoring. If neither is enabled+public, no card surfaces.
      const aiPolicy = modes.includes('author') ? cards['ai_policy']?.contentJson ?? null : null;
      const readingGuide = modes.includes('reader') ? cards['reading_guide']?.contentJson ?? null : null;
      return {
        did,
        modes,
        cards: {
          ai_policy: aiPolicy,
          reading_guide: readingGuide,
        },
      };
    },
  );
}

