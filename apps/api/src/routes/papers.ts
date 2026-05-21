import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  Errors,
  computeTrustPassport,
  openxivIdToUrl,
  parseOpenxivId,
  type TrustPassportInputs,
} from '@openxiv/shared';
import { buildProvenanceTimeline } from '../services/provenance.js';
import { countEndorsementsForPaper } from '../services/endorsements-stats.js';
import {
  citationFileExtension,
  generateCitation,
  normalizeCitationFormat,
} from '../services/citations.js';
import {
  extractCitationContentEvidence,
  extractCitationEvidenceItemsFromSections,
  extractCitationSectionsFromSourceFiles,
  isReferenceSection,
  type CitationContentEvidence,
  type CitationEvidenceSection,
} from '../services/citation-evidence.js';
import { extractToFileNodes } from '../services/archive-extract.js';
import {
  buildTrustPassportJsonLd,
  canonicalJson,
  loadServiceSigningKey,
  signWithConfiguredServiceKey,
  verifyExternalAttestationSignature,
  verifyTrustPassportBundle,
  type ExternalAttestationSubmission,
  type SignedTrustPassportJsonLd,
  type TrustPassportCheckItem,
  type TrustPassportExternalAttestation,
  type TrustPassportPublicDispute,
  type TrustPassportPublicDisputeResponse,
} from '../services/trust-passport-bundle.js';
import type { AppContext } from '../context.js';
import type { PaperWithRelations } from '@openxiv/db';

/**
 * AT-Proto DIDs follow two methods we mint or accept: did:plc (network-issued)
 * and did:web (DNS-anchored). Anything else is foreign and we cannot resolve
 * the submitter's keys, so the Identity lane of Trust Passport refuses to
 * count it as a strong signal.
 */
const DID_VALID_RE = /^did:(plc|web):[a-z0-9._:%-]+$/i;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.string().optional(),
  submitter: z.string().optional(),
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PASSPORT_LANES = [
  'transparency',
  'identity',
  'provenance',
  'citations',
  'math',
  'integrity',
  'socialReview',
] as const;
const passportLaneSchema = z.enum(PASSPORT_LANES);

const passportDisputeSchema = z.object({
  lane: passportLaneSchema,
  text: z.string().min(20).max(2000),
  targetRef: z.string().trim().min(1).max(200).optional(),
});

const passportDisputeResponseSchema = z.object({
  text: z.string().trim().min(20).max(2000),
});

const passportDisputeStatusSchema = z.object({
  status: z.enum(['open', 'highlighted', 'resolved']),
});

const passportVerifySchema = z.object({
  baselineDigest: z.string().trim().min(8).max(200).optional(),
  baselinePassport: z.object({}).passthrough().optional(),
});

const passportAttestationSchema = z.object({
  issuer: z
    .string()
    .trim()
    .regex(/^did:web:[a-z0-9._:%-]+$/i),
  publicKeyMultibase: z.string().trim().min(20).max(200),
  paper_id: z.string().trim().min(8).max(120),
  lane: passportLaneSchema,
  statement: z.string().trim().min(20).max(2000),
  verificationUrl: z.string().url().max(500).nullable().optional(),
  createdAt: z.string().datetime(),
  signature: z.string().trim().min(20).max(500),
});

function isPassportLane(lane: string | undefined): lane is (typeof PASSPORT_LANES)[number] {
  return PASSPORT_LANES.includes(lane as (typeof PASSPORT_LANES)[number]);
}

function passportDisputeLabelForStatus(status: 'open' | 'highlighted' | 'resolved'): string | null {
  switch (status) {
    case 'highlighted':
      return 'best_unresolved';
    case 'resolved':
      return 'resolved_by_v2';
    case 'open':
      return null;
  }
}

export async function papersRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  app.get('/papers', { schema: { querystring: listQuerySchema } }, async (req) => {
    const { limit, offset, category, submitter } = req.query as z.infer<typeof listQuerySchema>;
    const result = await ctx.repos.papers.list({
      status: 'published',
      ...(category ? { primaryCategory: category } : {}),
      ...(submitter ? { submitterDid: submitter } : {}),
      limit,
      offset,
    });
    if (result.isErr()) throw result.error;
    // Batch-load first figure for each paper. One query for the whole
    // page, vs N queries from the serializer. The repo returns an
    // empty map when no figures exist; the serializer treats that as
    // "fall back to the cover".
    const thumbMap = await loadFigureThumbs(
      ctx,
      result.value.map((p) => p.id),
    );
    return {
      items: result.value.map((p) => serializePaperSummary(p, thumbMap[p.id])),
    };
  });

  app.get(
    '/papers/:id/passport',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const signed = await buildSignedPassportForPaper(id);
      reply
        .header('content-type', 'application/ld+json; charset=utf-8')
        .header('cache-control', 'public, max-age=60, s-maxage=300')
        .header('access-control-allow-origin', '*');
      return signed;
    },
  );

  app.post(
    '/papers/:id/passport/verify',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: passportVerifySchema,
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { baselineDigest, baselinePassport } = req.body as z.infer<typeof passportVerifySchema>;
      const signed = await buildSignedPassportForPaper(id);
      const key = loadServiceSigningKey(ctx.env);
      let signatureValid = false;
      try {
        signatureValid = verifyTrustPassportBundle(signed, key.publicKey);
      } catch {
        signatureValid = false;
      }
      const comparison = comparePassportRerun({
        baselineDigest,
        baselinePassport,
        current: signed,
        publicKey: key.publicKey,
      });
      return {
        ok: signatureValid,
        rerunAt: new Date().toISOString(),
        signatureValid,
        semanticDigest: signed.semanticDigest,
        matchesBaseline: comparison.changed === null ? null : !comparison.changed,
        comparison,
        generatedAt: signed.generatedAt,
        versionId: signed.version_id,
        lanes: signed.checks.map((check) => ({
          lane: check.lane,
          status: check.status,
          issueLevel: check.issueLevel,
          summary: check.summary,
        })),
        passport: signed,
      };
    },
  );

  app.post(
    '/papers/:id/passport/disputes',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: passportDisputeSchema,
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof passportDisputeSchema>;
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (!paperRow.uri) {
        throw Errors.conflict(
          'paper has not been bridged to PDS yet — cannot accept passport disputes',
        );
      }
      const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const uri = `at://${req.session.did}/app.openxiv.post/${tid}`;
      const tags = [
        'trust-dispute',
        `trust-lane:${body.lane}`,
        ...(body.targetRef ? [`trust-target:${body.targetRef}`] : []),
      ];
      const created = await ctx.repos.posts.create({
        uri,
        cid: null,
        authorDid: req.session.did,
        text: body.text,
        replyRootUri: null,
        replyParentUri: null,
        embedPaperUri: paperRow.uri,
        embedExternal: null,
        tags,
        langs: null,
      });
      if (created.isErr()) throw created.error;
      return {
        id: created.value.id,
        uri: created.value.uri,
        lane: body.lane,
        targetRef: body.targetRef ?? null,
        text: created.value.text,
        authorDid: created.value.authorDid,
        createdAt: created.value.createdAt.toISOString(),
      };
    },
  );

  app.post(
    '/papers/:id/passport/disputes/:disputeId/responses',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string(), disputeId: z.string() }),
        body: passportDisputeResponseSchema,
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id, disputeId } = req.params as { id: string; disputeId: string };
      const body = req.body as z.infer<typeof passportDisputeResponseSchema>;
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (!paperRow.uri) {
        throw Errors.conflict(
          'paper has not been bridged to PDS yet — cannot accept passport dispute responses',
        );
      }

      const dispute = await ctx.repos.posts.findById(disputeId);
      if (dispute.isErr()) throw dispute.error;
      if (!dispute.value || dispute.value.embedPaperUri !== paperRow.uri) {
        throw Errors.notFound('passport dispute');
      }
      const disputeTags = dispute.value.tags ?? [];
      if (!disputeTags.includes('trust-dispute')) {
        throw Errors.validation('target post is not a Passport dispute');
      }
      const lane = disputeTags
        .find((tag) => tag.startsWith('trust-lane:'))
        ?.slice('trust-lane:'.length);
      if (!isPassportLane(lane)) {
        throw Errors.validation('Passport dispute is missing a valid lane');
      }

      if (!(await canRespondToPassportDispute(req.session, paperRow.submitterDid))) {
        throw Errors.forbidden(
          'only the paper submitter, moderators, or admins can answer Passport disputes',
        );
      }

      const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const uri = `at://${req.session.did}/app.openxiv.post/${tid}`;
      const created = await ctx.repos.posts.create({
        uri,
        cid: null,
        authorDid: req.session.did,
        text: body.text,
        replyRootUri: dispute.value.uri,
        replyParentUri: dispute.value.uri,
        embedPaperUri: paperRow.uri,
        embedExternal: null,
        tags: [
          'trust-dispute-response',
          `trust-lane:${lane}`,
          `trust-response-to:${dispute.value.id}`,
        ],
        langs: null,
      });
      if (created.isErr()) throw created.error;
      return {
        id: created.value.id,
        uri: created.value.uri,
        disputeId: dispute.value.id,
        disputeUri: dispute.value.uri,
        lane,
        authorDid: created.value.authorDid,
        text: created.value.text,
        createdAt: created.value.createdAt.toISOString(),
      };
    },
  );

  app.post(
    '/papers/:id/passport/disputes/:disputeId/status',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string(), disputeId: z.string() }),
        body: passportDisputeStatusSchema,
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id, disputeId } = req.params as { id: string; disputeId: string };
      const body = req.body as z.infer<typeof passportDisputeStatusSchema>;
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (!paperRow.uri) {
        throw Errors.conflict(
          'paper has not been bridged to PDS yet — cannot update passport dispute status',
        );
      }

      const dispute = await ctx.repos.posts.findById(disputeId);
      if (dispute.isErr()) throw dispute.error;
      if (!dispute.value || dispute.value.embedPaperUri !== paperRow.uri) {
        throw Errors.notFound('passport dispute');
      }
      const disputeTags = dispute.value.tags ?? [];
      if (!disputeTags.includes('trust-dispute')) {
        throw Errors.validation('target post is not a Passport dispute');
      }
      const lane = disputeTags
        .find((tag) => tag.startsWith('trust-lane:'))
        ?.slice('trust-lane:'.length);
      if (!isPassportLane(lane)) {
        throw Errors.validation('Passport dispute is missing a valid lane');
      }

      if (!(await canRespondToPassportDispute(req.session, paperRow.submitterDid))) {
        throw Errors.forbidden(
          'only the paper submitter, moderators, or admins can update Passport dispute status',
        );
      }

      const label = passportDisputeLabelForStatus(body.status);
      const updated = await ctx.repos.posts.setLabel(dispute.value.id, label);
      if (updated.isErr()) throw updated.error;
      return {
        id: updated.value.id,
        uri: updated.value.uri,
        lane,
        status: body.status,
        label,
        updatedAt: new Date().toISOString(),
      };
    },
  );

  app.post(
    '/papers/:id/passport/attestations',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: passportAttestationSchema,
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof passportAttestationSchema>;
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (!paperRow.uri) {
        throw Errors.conflict(
          'paper has not been bridged to PDS yet — cannot accept passport attestations',
        );
      }
      const loaded = await ctx.repos.papers.loadWithRelations(paperRow.id);
      if (loaded.isErr()) throw loaded.error;
      if (!loaded.value) throw Errors.notFound('paper');

      const expectedPaperId = loaded.value.paper.openxivId ?? `openxiv:${loaded.value.paper.id}`;
      if (body.paper_id !== expectedPaperId) {
        throw Errors.validation('attestation paper_id does not match this paper');
      }
      const normalized: ExternalAttestationSubmission = {
        issuer: body.issuer,
        publicKeyMultibase: body.publicKeyMultibase,
        paper_id: body.paper_id,
        lane: body.lane,
        statement: body.statement,
        verificationUrl: body.verificationUrl ?? null,
        createdAt: body.createdAt,
        signature: body.signature,
      };
      if (!verifyExternalAttestationSignature(normalized)) {
        throw Errors.validation('invalid external attestation signature');
      }

      const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const uri = `at://${body.issuer}/app.openxiv.post/${tid}`;
      const created = await ctx.repos.posts.create({
        uri,
        cid: null,
        authorDid: body.issuer,
        text: body.statement,
        replyRootUri: null,
        replyParentUri: null,
        embedPaperUri: paperRow.uri,
        embedExternal: {
          uri:
            body.verificationUrl ??
            `${ctx.env.PUBLIC_WEB_BASE.replace(/\/+$/, '')}/abs/${encodeURIComponent(id)}/passport.json`,
          title: 'Signed Passport attestation',
          description: body.signature,
        },
        tags: [
          'trust-attestation',
          `trust-lane:${body.lane}`,
          `trust-issuer:${body.issuer}`,
          `trust-pubkey:${body.publicKeyMultibase}`,
          `trust-created-at:${body.createdAt}`,
        ],
        langs: null,
      });
      if (created.isErr()) throw created.error;
      return {
        id: created.value.id,
        uri: created.value.uri,
        issuer: body.issuer,
        publicKeyMultibase: body.publicKeyMultibase,
        lane: body.lane,
        statement: body.statement,
        signature: body.signature,
        signatureVerified: true,
        verificationUrl: body.verificationUrl ?? null,
        createdAt: body.createdAt,
      };
    },
  );

  /**
   * Lookup by either UUID or openxiv id (URL form, e.g. `physics.2026.00001`).
   * Web pages and external links use the openxiv id; internal flows use UUID.
   */
  app.get('/papers/:id', { schema: { params: z.object({ id: z.string() }) } }, async (req) => {
    const { id } = req.params as { id: string };
    const paperRow = await resolvePaper(id);
    if (!paperRow) throw Errors.notFound('paper');
    const result = await ctx.repos.papers.loadWithRelations(paperRow.id);
    if (result.isErr()) throw result.error;
    if (!result.value) throw Errors.notFound('paper');

    const loaded = result.value;
    const [pdfUrl, htmlUrl] = await Promise.all([
      loaded.latestVersion?.finalPdfUrl
        ? Promise.resolve(loaded.latestVersion.finalPdfUrl)
        : loaded.latestVersion?.pdfKey
          ? ctx.clients.storage
              .presignGet(loaded.latestVersion.pdfKey, 3600)
              .then((r) => (r.isOk() ? r.value : null))
          : Promise.resolve(null),
      loaded.latestVersion?.htmlKey
        ? ctx.clients.storage
            .presignGet(loaded.latestVersion.htmlKey, 3600)
            .then((r) => (r.isOk() ? r.value : null))
        : Promise.resolve(null),
    ]);

    // Saga internals are pipeline state, not bibliographic metadata.
    // Only the submitter and moderators/admins see them — third parties never need
    // to know which stage failed nor read raw error text.
    const requesterDid = req.session?.did ?? null;
    let requesterCanModerate = requesterDid !== null && services.users.isAdminDid(requesterDid);
    if (!requesterCanModerate && req.session) {
      const requester = await services.users.getById(req.session.uid);
      requesterCanModerate =
        requester.isOk() &&
        (requester.value.role === 'admin' || requester.value.role === 'moderator');
    }
    const canSeeSaga =
      requesterCanModerate || (requesterDid !== null && requesterDid === loaded.paper.submitterDid);
    // The bridge bit is the only saga state we surface publicly (positive
    // social broadcast). Everyone gets to read that — the gate is just on
    // the *internal* per-stage diagnostic block.
    const sagaForBridge = await ctx.repos.sagas.get(loaded.paper.id);
    const sagaRow = sagaForBridge.isOk() ? sagaForBridge.value : null;
    const sectionsFirstIndexed = await ctx.repos.sections.firstIndexedAt(loaded.paper.id);
    const sectionsFirstIndexedAt = sectionsFirstIndexed.isOk() ? sectionsFirstIndexed.value : null;
    const provenance = buildProvenanceTimeline({
      loaded,
      sectionsFirstIndexedAt,
      bridgeDone: loaded.latestVersion?.bridgeStatus === 'posted',
    });
    const publicDisputes = await loadPublicDisputes(ctx, loaded.paper.uri);
    const saga = canSeeSaga ? sagaRow : null;
    return {
      id: loaded.paper.id,
      openxivId: loaded.paper.openxivId,
      openxivUrlId: loaded.paper.openxivId ? openxivIdToUrl(loaded.paper.openxivId) : null,
      uri: loaded.paper.uri,
      cid: loaded.paper.cid,
      title: loaded.paper.title,
      abstract: loaded.paper.abstract,
      license: loaded.paper.license,
      primaryCategory: loaded.paper.primaryCategory,
      // The text[] mirror of paper_categories that the GIN-indexed
      // feed/topic queries use. Surfaced alongside `categories` (which
      // is the joined m2m list) so a client can render primary +
      // secondary badges without a second round-trip.
      crossListings: loaded.paper.crossListings ?? [],
      categories: loaded.categories,
      keywords: loaded.keywords,
      status: loaded.paper.status,
      doi: loaded.paper.doi,
      createdAt: loaded.paper.createdAt.toISOString(),
      updatedAt: loaded.paper.updatedAt.toISOString(),
      publishedAt: loaded.paper.publishedAt?.toISOString() ?? null,
      submitterDid: loaded.paper.submitterDid,
      authors: loaded.authors.map((a) => ({
        position: a.position,
        displayName: a.displayName,
        orcid: a.orcid,
        affiliation: a.affiliation,
        did: a.did,
        isCorresponding: a.isCorresponding,
      })),
      latestVersion: loaded.latestVersion
        ? {
            id: loaded.latestVersion.id,
            versionNumber: loaded.latestVersion.versionNumber,
            fileSha256: loaded.latestVersion.fileSha256,
            sizeBytes: loaded.latestVersion.sizeBytes,
            pageCount: loaded.latestVersion.pageCount,
            pdfUrl,
            htmlUrl,
            bskyPostUri: loaded.latestVersion.bskyPostUri,
            bridgeStatus: loaded.latestVersion.bridgeStatus,
            mastodonStatusId: loaded.latestVersion.mastodonStatusId,
            mastodonStatusUrl: loaded.latestVersion.mastodonStatusUrl,
            mastodonPostStatus: loaded.latestVersion.mastodonPostStatus,
          }
        : null,
      disclosure: loaded.disclosure
        ? {
            level: loaded.disclosure.level,
            aiUsed: loaded.disclosure.aiUsed,
            models: loaded.disclosure.models,
            notes: loaded.disclosure.notes,
            summaryAiGenerated: loaded.disclosure.summaryAiGenerated,
            humanVerified: loaded.disclosure.humanVerified,
            attestation: loaded.disclosure.attestation,
          }
        : null,
      summaries: loaded.summaries.map((s) => ({
        tier: s.tier,
        text: s.text,
        aiGenerated: s.aiGenerated,
        aiModel: s.aiModel,
        createdAt: s.createdAt.toISOString(),
      })),
      saga: saga
        ? {
            stages: {
              paperPersisted: saga.stagePaperPersisted,
              paperApproved: saga.stagePaperApproved,
              idAssigned: saga.stageIdAssigned,
              pdsPaper: saga.stagePdsPaper,
              pdsSummaryDisclosure: saga.stagePdsSummaryDisclosure,
              blueskyBridge: saga.stageBlueskyBridge,
            },
            lastError: saga.lastError,
            lastErrorStage: saga.lastErrorStage,
            attempts: saga.attempts,
          }
        : null,
      oneHardQuestion: loaded.paper.oneHardQuestion,
      launchKit: loaded.paper.launchKit,
      provenance,
      trust: await computePaperTrust(ctx, loaded, publicDisputes, provenance.completion),
    };
  });

  app.get(
    '/papers/:id/citation',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({ format: z.string().optional() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { format: rawFormat } = req.query as { format?: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const loaded = await ctx.repos.papers.loadWithRelations(paperRow.id);
      if (loaded.isErr()) throw loaded.error;
      if (!loaded.value) throw Errors.notFound('paper');
      const format = normalizeCitationFormat(rawFormat);
      const text = generateCitation(loaded.value, format, { publicBase: ctx.env.PUBLIC_WEB_BASE });
      const ext = citationFileExtension(format);
      const filename = `${loaded.value.paper.openxivId ? openxivIdToUrl(loaded.value.paper.openxivId) : loaded.value.paper.id}.${ext}`;
      reply
        .header('content-type', 'text/plain; charset=utf-8')
        .header('content-disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
      return text;
    },
  );

  /** Retry the submission saga from the first incomplete stage. */
  app.post(
    '/papers/:id/retry',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (
        paperRow.submitterDid !== req.session.did &&
        !services.users.isAdminDid(req.session.did)
      ) {
        throw Errors.forbidden('only submitter or admin can retry saga');
      }
      const result = await services.submissions.retrySaga(paperRow.id);
      if (result.isErr()) throw result.error;
      return { ok: true };
    },
  );

  /** Admin-only: enqueue HTML recompilation for an existing paper version. */
  app.post(
    '/admin/papers/:id/recompile-html',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) {
        throw Errors.forbidden('admin only');
      }
      const { id } = req.params as { id: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const result = await services.submissions.recompileHtml(paperRow.id, {
        requestedByDid: req.session.did,
      });
      if (result.isErr()) throw result.error;
      return { ok: true, ...result.value };
    },
  );

  app.post(
    '/papers/:id/explain',
    {
      // Require auth so we have a stable userId for per-user daily quotas.
      // Cache hits don't count, so logged-in readers don't see the limit
      // until they keep regenerating fresh summaries for different papers.
      preHandler: app.requireAuth,
      // Tighter per-IP throttle than the global limiter: explain is the
      // single most expensive endpoint we expose, and it's reachable by
      // any signed-in user. 6/min/IP is enough for normal reading flow.
      config: {
        rateLimit: {
          max: 6,
          timeWindow: 60_000,
          keyGenerator: (req: { ip: string; session?: { uid?: string } }) =>
            `explain:${req.session?.uid ?? req.ip}`,
        },
      },
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ tier: z.enum(['school', 'undergrad', 'expert']) }),
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const { tier } = req.body as { tier: 'school' | 'undergrad' | 'expert' };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const result = await services.explain.explain({
        paperId: paperRow.id,
        tier,
        userId: req.session.uid,
      });
      if (result.isErr()) throw result.error;
      return result.value;
    },
  );

  app.get(
    '/papers/:id/pdf',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const loaded = await ctx.repos.papers.loadWithRelations(paperRow.id);
      if (loaded.isErr()) throw loaded.error;
      const latest = loaded.value?.latestVersion;
      if (!latest) throw Errors.notFound('pdf');
      // Prefer the finalized PDF — that's the one carrying the OpenXiv
      // cover page, left sidebar, and XMP openxiv: marker. The original
      // Tectonic output (pdfKey) is only used as a fallback when the
      // pdf-finalize pipeline hasn't run yet (brand-new submissions,
      // older papers before backfill, finalize errors). Without this
      // check, every download/preview/citation_pdf_url path served the
      // bare LaTeX output and the cover was effectively invisible to
      // readers even though pdf-finalize had already built it.
      if (latest.finalPdfUrl) {
        reply.header('cache-control', 'no-store, max-age=0');
        reply.redirect(latest.finalPdfUrl);
        return;
      }
      if (!latest.pdfKey) throw Errors.notFound('pdf');
      const presigned = await ctx.clients.storage.presignGet(latest.pdfKey, 3600);
      if (presigned.isErr()) throw presigned.error;
      reply.redirect(presigned.value);
    },
  );

  /**
   * Resolve a paper by UUID or by openxiv id (URL form or canonical `openxiv:…`).
   * Returns the underlying row so downstream code can use the internal UUID.
   */
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

  async function buildSignedPassportForPaper(id: string): Promise<SignedTrustPassportJsonLd> {
    const paperRow = await resolvePaper(id);
    if (!paperRow) throw Errors.notFound('paper');
    const loaded = await ctx.repos.papers.loadWithRelations(paperRow.id);
    if (loaded.isErr()) throw loaded.error;
    if (!loaded.value) throw Errors.notFound('paper');

    const expectedPaperId = loaded.value.paper.openxivId ?? `openxiv:${loaded.value.paper.id}`;
    const [publicDisputes, publicDisputeResponses, externalAttestations, citationItems, mathItems] =
      await Promise.all([
        loadPublicDisputes(ctx, loaded.value.paper.uri),
        loadPublicDisputeResponses(ctx, loaded.value.paper.uri),
        loadExternalAttestations(ctx, loaded.value.paper.uri, expectedPaperId),
        loadCitationEvidenceItems(ctx, loaded.value),
        loadMathEvidenceItems(ctx, loaded.value),
      ]);
    const trust = await computePaperTrust(ctx, loaded.value, publicDisputes);
    const openxivUrlId = loaded.value.paper.openxivId
      ? openxivIdToUrl(loaded.value.paper.openxivId)
      : null;
    const unsigned = buildTrustPassportJsonLd({
      publicBase: ctx.env.PUBLIC_WEB_BASE,
      paperId: loaded.value.paper.id,
      openxivId: loaded.value.paper.openxivId,
      openxivUrlId,
      title: loaded.value.paper.title,
      versionId: loaded.value.latestVersion?.id ?? null,
      generatedAt: new Date().toISOString(),
      issuerDid: ctx.env.FEED_GENERATOR_DID,
      trust,
      citationItems,
      mathItems,
      publicDisputes,
      publicDisputeResponses,
      externalAttestations,
    });
    return signWithConfiguredServiceKey(unsigned, ctx.env);
  }

  async function canRespondToPassportDispute(
    session: { uid: string; did: string; role?: string },
    submitterDid: string,
  ): Promise<boolean> {
    if (session.did === submitterDid || services.users.isAdminDid(session.did)) return true;
    const user = await services.users.getById(session.uid);
    return user.isOk() && (user.value.role === 'admin' || user.value.role === 'moderator');
  }
}

function serializePaperSummary(
  p: {
    id: string;
    openxivId: string | null;
    uri: string | null;
    title: string;
    primaryCategory: string;
    crossListings?: string[] | null;
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    submitterDid: string;
  },
  thumbUrl?: string | null,
): Record<string, unknown> {
  return {
    id: p.id,
    openxivId: p.openxivId,
    openxivUrlId: p.openxivId ? openxivIdToUrl(p.openxivId) : null,
    uri: p.uri,
    title: p.title,
    primaryCategory: p.primaryCategory,
    crossListings: p.crossListings ?? [],
    status: p.status,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    submitterDid: p.submitterDid,
    ...(thumbUrl ? { thumbUrl } : {}),
  };
}

type PassportVerifyComparison =
  | {
      readonly mode: 'none';
      readonly baselineDigest: null;
      readonly currentDigest: string;
      readonly changed: null;
      readonly changedLanes: readonly [];
      readonly historyDelta: null;
      readonly publicDisputeDelta: null;
      readonly externalAttestationDelta: null;
    }
  | {
      readonly mode: 'digest';
      readonly baselineDigest: string;
      readonly currentDigest: string;
      readonly changed: boolean;
      readonly changedLanes: readonly [];
      readonly historyDelta: null;
      readonly publicDisputeDelta: null;
      readonly externalAttestationDelta: null;
    }
  | {
      readonly mode: 'bundle';
      readonly baselineSignatureValid: boolean;
      readonly baselineDigest: string;
      readonly currentDigest: string;
      readonly changed: boolean;
      readonly changedLanes: ReadonlyArray<{
        readonly lane: SignedTrustPassportJsonLd['checks'][number]['lane'];
        readonly baselineStatus: SignedTrustPassportJsonLd['checks'][number]['status'] | null;
        readonly currentStatus: SignedTrustPassportJsonLd['checks'][number]['status'];
        readonly baselineIssueLevel: SignedTrustPassportJsonLd['checks'][number]['issueLevel'] | null;
        readonly currentIssueLevel: SignedTrustPassportJsonLd['checks'][number]['issueLevel'];
        readonly baselineSummary: SignedTrustPassportJsonLd['checks'][number]['summary'] | null;
        readonly currentSummary: SignedTrustPassportJsonLd['checks'][number]['summary'];
      }>;
      readonly historyDelta: number;
      readonly publicDisputeDelta: number;
      readonly externalAttestationDelta: number;
    };

function comparePassportRerun(input: {
  readonly baselineDigest?: string;
  readonly baselinePassport?: unknown;
  readonly current: SignedTrustPassportJsonLd;
  readonly publicKey: Uint8Array;
}): PassportVerifyComparison {
  const baseline = isSignedTrustPassportCandidate(input.baselinePassport)
    ? input.baselinePassport
    : null;
  if (baseline) {
    return comparePassportBundle(baseline, input.current, input.publicKey);
  }
  if (input.baselineDigest) {
    return {
      mode: 'digest',
      baselineDigest: input.baselineDigest,
      currentDigest: input.current.semanticDigest,
      changed: input.baselineDigest !== input.current.semanticDigest,
      changedLanes: [],
      historyDelta: null,
      publicDisputeDelta: null,
      externalAttestationDelta: null,
    };
  }
  return {
    mode: 'none',
    baselineDigest: null,
    currentDigest: input.current.semanticDigest,
    changed: null,
    changedLanes: [],
    historyDelta: null,
    publicDisputeDelta: null,
    externalAttestationDelta: null,
  };
}

function comparePassportBundle(
  baseline: SignedTrustPassportJsonLd,
  current: SignedTrustPassportJsonLd,
  publicKey: Uint8Array,
): PassportVerifyComparison {
  const baselineByLane = new Map(baseline.checks.map((check) => [check.lane, check]));
  const changedLanes = current.checks
    .map((currentCheck) => {
      const baselineCheck = baselineByLane.get(currentCheck.lane) ?? null;
      if (
        baselineCheck &&
        baselineCheck.status === currentCheck.status &&
        baselineCheck.issueLevel === currentCheck.issueLevel &&
        canonicalJson(baselineCheck.summary) === canonicalJson(currentCheck.summary)
      ) {
        return null;
      }
      return {
        lane: currentCheck.lane,
        baselineStatus: baselineCheck?.status ?? null,
        currentStatus: currentCheck.status,
        baselineIssueLevel: baselineCheck?.issueLevel ?? null,
        currentIssueLevel: currentCheck.issueLevel,
        baselineSummary: baselineCheck?.summary ?? null,
        currentSummary: currentCheck.summary,
      };
    })
    .filter((change): change is NonNullable<typeof change> => change !== null);

  return {
    mode: 'bundle',
    baselineSignatureValid: verifyTrustPassportBundle(baseline, publicKey),
    baselineDigest: baseline.semanticDigest,
    currentDigest: current.semanticDigest,
    changed: baseline.semanticDigest !== current.semanticDigest,
    changedLanes,
    historyDelta: current.history.length - baseline.history.length,
    publicDisputeDelta: current.publicDisputes.length - baseline.publicDisputes.length,
    externalAttestationDelta:
      current.externalAttestations.length - baseline.externalAttestations.length,
  };
}

function isSignedTrustPassportCandidate(value: unknown): value is SignedTrustPassportJsonLd {
  const record = asRecord(value);
  if (!record) return false;
  return (
    record['type'] === 'OpenXivTrustPassport' &&
    typeof record['semanticDigest'] === 'string' &&
    typeof record['signature'] === 'string' &&
    Array.isArray(record['checks']) &&
    Array.isArray(record['history']) &&
    Array.isArray(record['publicDisputes']) &&
    Array.isArray(record['externalAttestations']) &&
    asRecord(record['proof']) !== null
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Pull the first-figure URL for each paperId in one batched query.
 * Failure → empty map; the list endpoint always returns, even when the
 * paper_figures table is empty or the query errors transiently.
 */
async function loadFigureThumbs(
  ctx: AppContext,
  paperIds: string[],
): Promise<Record<string, string>> {
  if (paperIds.length === 0) return {};
  const r = await ctx.repos.paperFigures.firstFigureForPapers(paperIds);
  if (r.isErr()) return {};
  return r.value;
}

async function computePaperTrust(
  ctx: AppContext,
  loaded: PaperWithRelations,
  publicDisputes: TrustPassportPublicDispute[] = [],
  provenanceCompletion?: number | null,
) {
  const [endorsementSignals, contentSignals] = await Promise.all([
    countEndorsementsForPaper(ctx, loaded.paper.id),
    contentTrustSignals(ctx, loaded),
  ]);

  return computeTrustPassport({
    hasDisclosure: Boolean(loaded.disclosure),
    disclosureLevel: loaded.disclosure?.level,
    disclosureHumanVerified: Boolean(loaded.disclosure?.humanVerified),
    disclosedModelCount: loaded.disclosure?.models.length ?? 0,
    hasPlainSummary: loaded.summaries.length > 0,
    hasAnyOrcid: loaded.authors.some((a) => Boolean(a.orcid && a.orcid.trim())),
    submitterDidValid: DID_VALID_RE.test(loaded.paper.submitterDid),
    authorCount: loaded.authors.length,
    identifiedAuthorCount: loaded.authors.filter((a) => Boolean(a.orcid?.trim() || a.did?.trim()))
      .length,
    hasSourceArchive: Boolean(loaded.latestVersion?.sourceKey),
    hasCompiledPdf: Boolean(loaded.latestVersion?.pdfKey || loaded.latestVersion?.finalPdfUrl),
    hasHtmlRendering: Boolean(loaded.latestVersion?.htmlKey),
    hasFileHash: Boolean(loaded.latestVersion?.fileSha256),
    provenanceCompletion: provenanceCompletion ?? null,
    detectorScore: loaded.detectorScore?.score ?? null,
    // Endorsement signals (count + verb diversity) drive the Social
    // Review lane. We compute both from a single query so the passport
    // never reflects a half-fresh view.
    ...endorsementSignals,
    ...contentSignals,
    publicDisputeCount: publicDisputes.length,
    resolvedDisputeCount: publicDisputes.filter((d) => d.status === 'resolved').length,
  });
}

type ContentTrustSignals = Pick<
  TrustPassportInputs,
  | 'hasReferenceSection'
  | 'citationMarkerCount'
  | 'referenceEntryCount'
  | 'resolvedReferenceCount'
  | 'mathHeavy'
  | 'mathExpressionCount'
  | 'theoremLikeCount'
>;

async function contentTrustSignals(
  ctx: AppContext,
  loaded: PaperWithRelations,
): Promise<ContentTrustSignals> {
  const empty: ContentTrustSignals = {
    hasReferenceSection: null,
    citationMarkerCount: null,
    referenceEntryCount: null,
    resolvedReferenceCount: null,
    mathHeavy: null,
    mathExpressionCount: null,
    theoremLikeCount: null,
  };

  const sectionsRepo = ctx.repos.sections;
  let sections: CitationEvidenceSection[] = [];
  if (sectionsRepo?.forPaper) {
    const result = await sectionsRepo.forPaper(loaded.paper.id);
    if (result.isOk()) {
      sections = result.value.map((section) => ({
        title: section.title ?? '',
        content: section.content ?? '',
      }));
    }
  }
  if (sections.length === 0 && !loaded.latestVersion?.sourceKey) return empty;

  const allText = [
    loaded.paper.title,
    loaded.paper.abstract ?? '',
    ...sections.flatMap((section) => [section.title, section.content]),
  ].join('\n');
  const citationSections = await loadBestCitationSections(ctx, loaded, sections);
  const citationEvidence = extractCitationContentEvidence(citationSections);

  const mathExpressionCount = countMathExpressions(allText);
  const theoremLikeCount = countTheoremLikeCues(allText);
  const categories = [
    loaded.paper.primaryCategory,
    ...(loaded.paper.crossListings ?? []),
    ...loaded.categories,
  ].filter(Boolean);

  return {
    ...citationEvidence,
    mathHeavy:
      categories.some((category) => /^math(?:\.|-|$)|math-ph/i.test(category)) ||
      mathExpressionCount >= 4 ||
      theoremLikeCount >= 2,
    mathExpressionCount,
    theoremLikeCount,
  };
}

async function loadCitationEvidenceItems(
  ctx: AppContext,
  loaded: PaperWithRelations,
): Promise<TrustPassportCheckItem[]> {
  const sectionsRepo = ctx.repos.sections;
  let sections: CitationEvidenceSection[] = [];
  if (sectionsRepo?.forPaper) {
    const result = await sectionsRepo.forPaper(loaded.paper.id);
    if (result.isOk()) {
      sections = result.value.map((section) => ({
        title: section.title ?? '',
        content: section.content ?? '',
      }));
    }
  }
  const citationSections = await loadBestCitationSections(ctx, loaded, sections);
  if (citationSections.length === 0) return [];
  return extractCitationEvidenceItemsFromSections(citationSections);
}

async function loadBestCitationSections(
  ctx: AppContext,
  loaded: PaperWithRelations,
  indexedSections: CitationEvidenceSection[],
): Promise<CitationEvidenceSection[]> {
  const indexedEvidence = extractCitationContentEvidence(indexedSections);
  if (!shouldTrySourceCitationFallback(indexedEvidence)) return indexedSections;

  const sourceSections = await loadSourceCitationSections(ctx, loaded);
  if (sourceSections.length === 0) return indexedSections;

  const sourceEvidence = extractCitationContentEvidence(sourceSections);
  return isCitationEvidenceBetter(sourceEvidence, indexedEvidence) ? sourceSections : indexedSections;
}

async function loadSourceCitationSections(
  ctx: AppContext,
  loaded: PaperWithRelations,
): Promise<CitationEvidenceSection[]> {
  const sourceKey = loaded.latestVersion?.sourceKey;
  if (!sourceKey) return [];

  const source = await ctx.clients.storage.get(sourceKey);
  if (source.isErr()) return [];

  try {
    const filename = sourceKey.split('/').pop() ?? 'source.tex';
    const files = await extractToFileNodes(source.value.body, filename);
    return extractCitationSectionsFromSourceFiles(files);
  } catch {
    return [];
  }
}

function shouldTrySourceCitationFallback(evidence: CitationContentEvidence): boolean {
  return (
    evidence.hasReferenceSection !== true ||
    (evidence.citationMarkerCount ?? 0) === 0 ||
    (evidence.referenceEntryCount ?? 0) === 0 ||
    (evidence.resolvedReferenceCount ?? 0) === 0
  );
}

function isCitationEvidenceBetter(
  candidate: CitationContentEvidence,
  current: CitationContentEvidence,
): boolean {
  const candidateRank = citationEvidenceRank(candidate);
  const currentRank = citationEvidenceRank(current);
  for (let i = 0; i < candidateRank.length; i += 1) {
    if (candidateRank[i]! > currentRank[i]!) return true;
    if (candidateRank[i]! < currentRank[i]!) return false;
  }
  return false;
}

function citationEvidenceRank(evidence: CitationContentEvidence): number[] {
  return [
    evidence.resolvedReferenceCount ?? 0,
    evidence.referenceEntryCount ?? 0,
    evidence.hasReferenceSection === true ? 1 : 0,
    evidence.citationMarkerCount ?? 0,
  ];
}

async function loadMathEvidenceItems(
  ctx: AppContext,
  loaded: PaperWithRelations,
): Promise<TrustPassportCheckItem[]> {
  const sectionsRepo = ctx.repos.sections;
  if (!sectionsRepo?.forPaper) return [];
  const result = await sectionsRepo.forPaper(loaded.paper.id);
  if (result.isErr() || result.value.length === 0) return [];
  const sections = result.value.map((section) => ({
    title: section.title ?? '',
    anchor: section.anchor ?? null,
    content: section.content ?? '',
  }));
  return extractMathEvidenceItems(sections, loaded);
}

interface IndexedSectionText {
  readonly title: string;
  readonly anchor: string | null;
  readonly content: string;
}

function extractMathEvidenceItems(
  sections: IndexedSectionText[],
  loaded: PaperWithRelations,
): TrustPassportCheckItem[] {
  const bodySections = sections.filter(
    (section) => !isReferenceSection(section.title, section.content),
  );
  const allText = bodySections.map((section) => `${section.title}\n${section.content}`).join('\n');
  const categories = [
    loaded.paper.primaryCategory,
    ...(loaded.paper.crossListings ?? []),
    ...loaded.categories,
  ].filter(Boolean);
  const mathExpressionCount = countMathExpressions(allText);
  const theoremLikeCount = countTheoremLikeCues(allText);
  const mathHeavy =
    categories.some((category) => /^math(?:\.|-|$)|math-ph/i.test(category)) ||
    mathExpressionCount >= 4 ||
    theoremLikeCount >= 2;

  if (!mathHeavy) return [];

  const formulaItems = collectFormulaEvidence(bodySections)
    .slice(0, 8)
    .map((candidate, index) =>
      mathEvidenceItem({
        ...candidate,
        label: `Formula evidence ${index + 1}`,
        note: `Formula-like expression found in ${candidate.section}.`,
        severity: 'info',
      }),
    );
  const formalItems = collectFormalStructureEvidence(bodySections)
    .slice(0, 6)
    .map((candidate, index) =>
      mathEvidenceItem({
        ...candidate,
        label: `Formal structure ${index + 1}`,
        note: `Formal statement/proof cue found in ${candidate.section}.`,
        severity: 'info',
      }),
    );

  const sourceAvailable = Boolean(loaded.latestVersion?.sourceKey);
  const sourceItem: TrustPassportCheckItem = {
    label: 'Source archive for math audit',
    category: 'source_archive',
    confidence: sourceAvailable ? 'high' : 'low',
    passed: sourceAvailable,
    status: sourceAvailable ? 'pass' : 'fail',
    note: sourceAvailable
      ? 'Source archive is retained for independent formula and derivation checks.'
      : 'No source archive is retained for independent formula and derivation checks.',
    weight: 1,
    value: sourceAvailable ? 1 : 0,
    severity: sourceAvailable ? 'info' : 'medium',
    source: 'pipeline',
    ...(sourceAvailable
      ? {}
      : { action: 'Attach the source archive so equations can be rebuilt and audited.' }),
  };

  const humanVerified = Boolean(loaded.disclosure?.humanVerified);
  const attestationItem: TrustPassportCheckItem = {
    label: 'Human math verification',
    category: 'human_attestation',
    confidence: humanVerified ? 'high' : 'low',
    passed: humanVerified,
    status: humanVerified ? 'pass' : 'fail',
    note: humanVerified
      ? 'Author attested that claims, citations, and numbers were human-verified.'
      : 'No author attestation covers mathematical verification.',
    weight: 1,
    value: humanVerified ? 1 : 0,
    severity: humanVerified ? 'info' : 'high',
    source: 'author',
    ...(humanVerified
      ? {}
      : { action: 'Add the human verification attestation for mathematical claims.' }),
  };

  const extractedItems = [...formulaItems, ...formalItems];
  const fallbackItem: TrustPassportCheckItem[] =
    extractedItems.length > 0
      ? []
      : [
          {
            label: 'Math evidence extraction',
            category: 'extraction',
            confidence: 'low',
            passed: false,
            status: 'fail',
            note: 'The paper looks math-heavy, but no concrete formula or formal statement snippet was extracted.',
            weight: 1,
            value: 0,
            severity: 'medium',
            source: 'pipeline',
            action: 'Repair text extraction so mathematical claims can be audited.',
          },
        ];

  return [...extractedItems, ...fallbackItem, sourceItem, attestationItem];
}

interface MathEvidenceCandidate {
  readonly category: string;
  readonly section: string;
  readonly anchor: string | null;
  readonly snippet: string;
  readonly confidence: 'high' | 'medium' | 'low';
}

function collectFormulaEvidence(sections: IndexedSectionText[]): MathEvidenceCandidate[] {
  const candidates: MathEvidenceCandidate[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const snippets = [
      ...matchesFor(
        section.content,
        /(?:\$\$?[^$\n]{1,240}\$\$?|\\\([^)]{1,240}\\\)|\\\[[\s\S]{1,500}\\\])/g,
      ),
      ...matchesFor(section.content, /\b[A-Za-z][A-Za-z0-9]*\s*=\s*[^.;\n]{2,180}/g),
      ...sentencesWith(
        section.content,
        /\\(?:frac|int|sum|prod|partial|nabla|sqrt|mathbb|mathbf)\b/,
      ),
    ];
    for (const raw of snippets) {
      const snippet = cleanSnippet(raw);
      if (!snippet || snippet.length < 4) continue;
      const key = snippet.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        category: 'formula',
        section: section.title || 'Untitled section',
        anchor: section.anchor,
        snippet,
        confidence: snippet.includes('=') || snippet.includes('\\') ? 'medium' : 'low',
      });
    }
  }
  return candidates;
}

function collectFormalStructureEvidence(sections: IndexedSectionText[]): MathEvidenceCandidate[] {
  const candidates: MathEvidenceCandidate[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const raw of sentencesWith(
      section.content,
      /\b(theorem|lemma|proposition|corollary|proof|definition|claim|equation|invariant|derivation)\b/i,
    )) {
      const snippet = cleanSnippet(raw);
      if (!snippet) continue;
      const key = snippet.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        category: 'formal_statement',
        section: section.title || 'Untitled section',
        anchor: section.anchor,
        snippet,
        confidence: /^(theorem|lemma|proposition|corollary|proof|definition|claim)\b/i.test(snippet)
          ? 'high'
          : 'medium',
      });
    }
  }
  return candidates;
}

function mathEvidenceItem(
  input: MathEvidenceCandidate & {
    readonly label: string;
    readonly note: string;
    readonly severity: 'info' | 'low' | 'medium' | 'high';
  },
): TrustPassportCheckItem {
  return {
    label: input.label,
    category: input.category,
    section: input.section,
    anchor: input.anchor,
    snippet: input.snippet,
    confidence: input.confidence,
    passed: true,
    status: 'pass',
    note: input.note,
    weight: 1,
    value: 1,
    severity: input.severity,
    source: 'pipeline',
  };
}

function matchesFor(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[0] ?? '');
}

function sentencesWith(text: string, pattern: RegExp): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z\\])/).filter((sentence) => pattern.test(sentence));
}

function cleanSnippet(value: string, maxLength = 220): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

function countRegex(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return text.match(new RegExp(pattern.source, flags))?.length ?? 0;
}

function countMathExpressions(text: string): number {
  return (
    countRegex(
      text,
      /\\(?:begin\{(?:equation|align|gather|multline)\*?\}|frac|sum|int|prod|partial|nabla|sqrt|alpha|beta|gamma|delta|lambda|mu|nu|rho|sigma|omega|Omega|mathbb|mathbf)\b/g,
    ) +
    countRegex(text, /<math[\s>]/gi) +
    countRegex(text, /(?:\$\$?[^$\n]{1,200}\$\$?|\\\([^)]{1,200}\\\)|\\\[[\s\S]{1,500}\\\])/g) +
    countRegex(text, /\b[A-Za-z][A-Za-z0-9]*\s*=\s*[-+*/^_{}A-Za-z0-9\\ ]{2,80}/g) +
    countRegex(text, /[A-Za-z0-9)\]}]\s*[\^_]\s*(?:\{[^}]{1,30}}|[A-Za-z0-9+-]+)/g)
  );
}

function countTheoremLikeCues(text: string): number {
  return countRegex(
    text,
    /\b(theorem|lemma|proposition|corollary|proof|definition|claim|equation|invariant|derivation)\b/gi,
  );
}

async function loadPublicDisputes(
  ctx: AppContext,
  paperUri: string | null,
): Promise<TrustPassportPublicDispute[]> {
  if (!paperUri) return [];
  const posts = await ctx.repos.posts.forPaperUri(paperUri, { includeHidden: false, limit: 200 });
  if (posts.isErr()) return [];
  return posts.value
    .map((post) => {
      const tags = post.tags ?? [];
      if (!tags.includes('trust-dispute')) return null;
      const laneTag = tags.find((tag) => tag.startsWith('trust-lane:'));
      const lane = laneTag?.slice('trust-lane:'.length);
      if (!isPassportLane(lane)) {
        return null;
      }
      const targetTag = tags.find((tag) => tag.startsWith('trust-target:'));
      return {
        id: post.id,
        uri: post.uri,
        lane,
        authorDid: post.authorDid,
        text: post.text,
        targetRef: targetTag ? targetTag.slice('trust-target:'.length) : null,
        status:
          post.label === 'resolved_by_v2'
            ? 'resolved'
            : post.label === 'best_unresolved'
              ? 'highlighted'
              : 'open',
        createdAt: post.createdAt.toISOString(),
      } satisfies TrustPassportPublicDispute;
    })
    .filter((post): post is TrustPassportPublicDispute => post !== null);
}

async function loadPublicDisputeResponses(
  ctx: AppContext,
  paperUri: string | null,
): Promise<TrustPassportPublicDisputeResponse[]> {
  if (!paperUri) return [];
  const posts = await ctx.repos.posts.forPaperUri(paperUri, { includeHidden: false, limit: 200 });
  if (posts.isErr()) return [];
  return posts.value
    .map((post) => {
      const tags = post.tags ?? [];
      if (!tags.includes('trust-dispute-response')) return null;
      const laneTag = tags.find((tag) => tag.startsWith('trust-lane:'));
      const lane = laneTag?.slice('trust-lane:'.length);
      if (!isPassportLane(lane)) {
        return null;
      }
      const responseTo = tags.find((tag) => tag.startsWith('trust-response-to:'));
      const disputeId = responseTo?.slice('trust-response-to:'.length);
      if (!disputeId) return null;
      return {
        id: post.id,
        uri: post.uri,
        disputeId,
        disputeUri: post.replyParentUri,
        lane,
        authorDid: post.authorDid,
        text: post.text,
        createdAt: post.createdAt.toISOString(),
      } satisfies TrustPassportPublicDisputeResponse;
    })
    .filter((post): post is TrustPassportPublicDisputeResponse => post !== null);
}

async function loadExternalAttestations(
  ctx: AppContext,
  paperUri: string | null,
  expectedPaperId: string,
): Promise<TrustPassportExternalAttestation[]> {
  if (!paperUri) return [];
  const posts = await ctx.repos.posts.forPaperUri(paperUri, { includeHidden: false, limit: 200 });
  if (posts.isErr()) return [];
  return posts.value
    .map((post) => {
      const tags = post.tags ?? [];
      if (!tags.includes('trust-attestation')) return null;
      const laneTag = tags.find((tag) => tag.startsWith('trust-lane:'));
      const lane = laneTag?.slice('trust-lane:'.length);
      if (!isPassportLane(lane)) {
        return null;
      }
      const issuer = tags
        .find((tag) => tag.startsWith('trust-issuer:'))
        ?.slice('trust-issuer:'.length);
      const publicKeyMultibase = tags
        .find((tag) => tag.startsWith('trust-pubkey:'))
        ?.slice('trust-pubkey:'.length);
      const signature = post.embedExternal?.description;
      if (!issuer || !signature || !publicKeyMultibase) return null;
      const verificationUrl = post.embedExternal?.uri ?? null;
      const signedCreatedAt = tags
        .find((tag) => tag.startsWith('trust-created-at:'))
        ?.slice('trust-created-at:'.length);
      const createdAt = signedCreatedAt || post.createdAt.toISOString();
      const signatureVerified = verifyExternalAttestationSignature({
        issuer,
        publicKeyMultibase,
        paper_id: expectedPaperId,
        lane,
        statement: post.text,
        signature,
        verificationUrl,
        createdAt,
      });
      return {
        id: post.id,
        uri: post.uri,
        issuer,
        publicKeyMultibase,
        lane,
        statement: post.text,
        signature,
        signatureVerified,
        verificationUrl,
        createdAt,
      } satisfies TrustPassportExternalAttestation;
    })
    .filter((post): post is TrustPassportExternalAttestation => post !== null);
}
