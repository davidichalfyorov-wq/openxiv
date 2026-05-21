import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  aiDetectorScores,
  disclosures,
  paperAuthors,
  paperCategories,
  paperKeywords,
  paperVersions,
  papers,
  summaries,
  type BridgeStatus,
  type DisclosureLevel,
  type LaunchKit,
  type PaperStatus,
  type SummaryTier,
  type VersionChangeFlags,
} from '../schema/papers.js';

export type PaperRecord = typeof papers.$inferSelect;
export type NewPaper = typeof papers.$inferInsert;
export type PaperAuthorRecord = typeof paperAuthors.$inferSelect;
export type PaperVersionRecord = typeof paperVersions.$inferSelect;
export type NewPaperVersion = typeof paperVersions.$inferInsert;
export type DisclosureRecord = typeof disclosures.$inferSelect;
export type SummaryRecord = typeof summaries.$inferSelect;
export type AiDetectorScore = typeof aiDetectorScores.$inferSelect;
export type SocialPushStatus = 'none' | 'pending' | 'posted' | 'failed' | 'skipped';

export interface PaperWithRelations {
  paper: PaperRecord;
  authors: PaperAuthorRecord[];
  categories: string[];
  keywords: string[];
  latestVersion: PaperVersionRecord | null;
  disclosure: DisclosureRecord | null;
  summaries: SummaryRecord[];
  detectorScore: AiDetectorScore | null;
}

export interface PapersListParams {
  status?: PaperStatus;
  /**
   * Filter papers belonging to this category. Matches `primary_category`
   * OR any entry in `cross_listings` (the GIN index makes this cheap).
   * For multi-category-aware feeds this is the canonical filter.
   */
  primaryCategory?: string;
  submitterDid?: string;
  /** Inclusive lower bound on `papers.updated_at`. OAI-PMH selective harvest. */
  updatedFrom?: Date;
  /** Inclusive upper bound on `papers.updated_at`. */
  updatedUntil?: Date;
  limit?: number;
  offset?: number;
}

export interface PapersRepository {
  create(input: NewPaper): AppResultAsync<PaperRecord>;
  findById(id: string): AppResultAsync<PaperRecord | null>;
  findByOpenxivId(openxivId: string): AppResultAsync<PaperRecord | null>;
  findByUri(uri: string): AppResultAsync<PaperRecord | null>;
  findByDoi(doi: string): AppResultAsync<PaperRecord | null>;
  /**
   * Persist a freshly-deposited DOI. The unique index on `doi` guarantees
   * uniqueness; a concurrent deposit race lands as a 23505 on the loser.
   */
  setDoi(id: string, doi: string): AppResultAsync<PaperRecord>;
  setStatus(id: string, status: PaperStatus): AppResultAsync<void>;
  /**
   * Update Author Launch Kit fields. `null` for either field is honored as
   * an explicit clear; `undefined` leaves the column alone.
   */
  setLaunchKit(
    id: string,
    fields: {
      oneHardQuestion?: string | null;
      launchKit?: LaunchKit | null;
    },
  ): AppResultAsync<PaperRecord>;
  setUri(id: string, uri: string, cid: string): AppResultAsync<void>;
  setOpenxivId(id: string, openxivId: string): AppResultAsync<void>;
  list(params?: PapersListParams): AppResultAsync<PaperRecord[]>;
  countByStatus(submitterDid: string): AppResultAsync<Record<PaperStatus, number>>;

  setAuthors(
    paperId: string,
    authors: Array<
      Omit<PaperAuthorRecord, 'paperId' | 'affiliationRor' | 'creditRoles'> & {
        affiliationRor?: string | null;
        creditRoles?: string[];
      }
    >,
  ): AppResultAsync<void>;
  setCategories(paperId: string, primary: string, secondary: string[]): AppResultAsync<void>;
  setKeywords(paperId: string, keywords: string[]): AppResultAsync<void>;

  addVersion(input: Omit<NewPaperVersion, 'id' | 'createdAt'>): AppResultAsync<PaperVersionRecord>;
  latestVersion(paperId: string): AppResultAsync<PaperVersionRecord | null>;
  setHtmlKey(versionId: string, htmlKey: string): AppResultAsync<PaperVersionRecord>;
  /** All versions of a paper, newest first. Used by the Version Changelog UI. */
  allVersions(paperId: string): AppResultAsync<PaperVersionRecord[]>;
  /**
   * Get version 1 of a paper. The bridge needs the v1 record to thread
   * later versions as replies — they share the same root post on Bluesky.
   * Returns null if v1 was deleted (admin scrub) or never persisted.
   */
  firstVersion(paperId: string): AppResultAsync<PaperVersionRecord | null>;
  /**
   * Update bridge outcome on a paper_versions row. Called from runBlueskyBridge
   * — `status='posted'` records the bsky URI + CID, `status='failed'` records
   * the error so an admin can retrigger, `status='skipped'` for opted-out users.
   */
  setBridgeResult(
    versionId: string,
    fields: {
      status: BridgeStatus;
      bskyPostUri?: string | null;
      bskyPostCid?: string | null;
      error?: string | null;
    },
  ): AppResultAsync<PaperVersionRecord>;
  /**
   * Append one claim-card reply to the version's auto-thread. Idempotency
   * lives at the caller: it checks `bskyThreadReplies` for an existing entry
   * at the same `claimIdx` and skips if present.
   */
  appendBridgeReply(
    versionId: string,
    reply: { claimIdx: number; uri: string; cid: string },
  ): AppResultAsync<PaperVersionRecord>;
  setMastodonPostResult(
    versionId: string,
    fields: {
      status: SocialPushStatus;
      statusId?: string | null;
      statusUrl?: string | null;
      error?: string | null;
    },
  ): AppResultAsync<PaperVersionRecord>;
  /**
   * Persist the URL of the cover-stamped final PDF on a version row,
   * plus the content-hash that drives idempotent re-build skipping.
   * The original `pdf_key` is left untouched — both blobs coexist.
   */
  setFinalPdf(
    versionId: string,
    fields: { url: string; contentHash: string },
  ): AppResultAsync<PaperVersionRecord>;
  /**
   * Update the structured changelog fields on an existing version. Only
   * affects the version_changelog block; binary fields (pdfKey, sha256)
   * are immutable once persisted.
   */
  setVersionChangelog(
    versionId: string,
    fields: {
      changeFlags?: VersionChangeFlags | null;
      becauseOf?: string | null;
      unresolved?: string | null;
      changelogNote?: string | null;
      diffUrl?: string | null;
    },
  ): AppResultAsync<PaperVersionRecord>;

  upsertDisclosure(input: {
    paperId: string;
    level: DisclosureLevel;
    aiUsed: string[];
    models: Array<{ name: string; vendor?: string; version?: string; usage?: string }>;
    notes?: string;
    summaryAiGenerated?: boolean;
    humanVerified?: boolean;
    attestation: string;
    uri?: string;
  }): AppResultAsync<DisclosureRecord>;
  getDisclosure(paperId: string): AppResultAsync<DisclosureRecord | null>;

  upsertSummary(input: {
    paperId: string;
    tier: SummaryTier;
    text: string;
    aiGenerated: boolean;
    aiModel?: string;
    uri?: string;
  }): AppResultAsync<SummaryRecord>;
  getSummary(paperId: string, tier: SummaryTier): AppResultAsync<SummaryRecord | null>;

  loadWithRelations(id: string): AppResultAsync<PaperWithRelations | null>;
  /**
   * Batch-load relations for many papers in 8 queries total (not 8×N). The
   * caller passes an array of ids; the result preserves the input order
   * and drops papers that no longer exist.
   */
  loadManyWithRelations(ids: readonly string[]): AppResultAsync<PaperWithRelations[]>;
}

const oneRow = <T>(label: string) => (rows: T[]): T => {
  const row = rows[0];
  if (!row) throw new Error(`${label}: expected row`);
  return row;
};

export function makePapersRepository(db: Database): PapersRepository {
  return {
    create(input) {
      return fromPromise(
        db.insert(papers).values(input).returning(),
        (cause) => Errors.internal('papers.create', cause),
      ).map(oneRow('papers.create'));
    },
    findById(id) {
      return fromPromise(
        db.select().from(papers).where(eq(papers.id, id)).limit(1),
        (cause) => Errors.internal('papers.findById', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByOpenxivId(openxivId) {
      return fromPromise(
        db.select().from(papers).where(eq(papers.openxivId, openxivId)).limit(1),
        (cause) => Errors.internal('papers.findByOpenxivId', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByUri(uri) {
      return fromPromise(
        db.select().from(papers).where(eq(papers.uri, uri)).limit(1),
        (cause) => Errors.internal('papers.findByUri', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByDoi(doi) {
      return fromPromise(
        db.select().from(papers).where(eq(papers.doi, doi)).limit(1),
        (cause) => Errors.internal('papers.findByDoi', cause),
      ).map((rows) => rows[0] ?? null);
    },
    setDoi(id, doi) {
      return fromPromise(
        db
          .update(papers)
          .set({ doi, updatedAt: new Date() })
          .where(eq(papers.id, id))
          .returning(),
        (cause) => Errors.internal('papers.setDoi', cause),
      ).map(oneRow('papers.setDoi'));
    },
    setStatus(id, status) {
      return fromPromise(
        db
          .update(papers)
          .set({ status, updatedAt: new Date() })
          .where(eq(papers.id, id)),
        (cause) => Errors.internal('papers.setStatus', cause),
      ).map(() => undefined);
    },
    setLaunchKit(id, fields) {
      const updates: Partial<NewPaper> = { updatedAt: new Date() };
      if (fields.oneHardQuestion !== undefined) updates.oneHardQuestion = fields.oneHardQuestion;
      if (fields.launchKit !== undefined) updates.launchKit = fields.launchKit;
      return fromPromise(
        db.update(papers).set(updates).where(eq(papers.id, id)).returning(),
        (cause) => Errors.internal('papers.setLaunchKit', cause),
      ).map(oneRow('papers.setLaunchKit'));
    },
    setUri(id, uri, cid) {
      return fromPromise(
        db
          .update(papers)
          .set({ uri, cid, updatedAt: new Date() })
          .where(eq(papers.id, id)),
        (cause) => Errors.internal('papers.setUri', cause),
      ).map(() => undefined);
    },
    setOpenxivId(id, openxivId) {
      return fromPromise(
        db
          .update(papers)
          .set({ openxivId, updatedAt: new Date() })
          .where(eq(papers.id, id)),
        (cause) => Errors.internal('papers.setOpenxivId', cause),
      ).map(() => undefined);
    },
    list(params = {}) {
      const conditions = [];
      if (params.status) conditions.push(eq(papers.status, params.status));
      if (params.primaryCategory) {
        // Match primary OR any cross-listing. The GIN index on
        // `cross_listings` (migration 0021) makes the second branch
        // O(log n) — verified by EXPLAIN in tests/.
        const cat = params.primaryCategory;
        conditions.push(
          sql`(${papers.primaryCategory} = ${cat} OR ${papers.crossListings} @> ARRAY[${cat}]::text[])`,
        );
      }
      if (params.submitterDid) conditions.push(eq(papers.submitterDid, params.submitterDid));
      if (params.updatedFrom) conditions.push(gte(papers.updatedAt, params.updatedFrom));
      if (params.updatedUntil) conditions.push(lte(papers.updatedAt, params.updatedUntil));
      const query = db
        .select()
        .from(papers)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${papers.publishedAt} DESC NULLS LAST`, desc(papers.createdAt))
        .limit(params.limit ?? 20)
        .offset(params.offset ?? 0);
      return fromPromise(query, (cause) => Errors.internal('papers.list', cause));
    },
    countByStatus(submitterDid) {
      return fromPromise(
        db
          .select({ status: papers.status, count: sql<number>`count(*)::int` })
          .from(papers)
          .where(eq(papers.submitterDid, submitterDid))
          .groupBy(papers.status),
        (cause) => Errors.internal('papers.countByStatus', cause),
      ).map((rows) => {
        const acc: Record<PaperStatus, number> = {
          draft: 0,
          compiling: 0,
          compile_failed: 0,
          pending_disclosure: 0,
          pending_review: 0,
          published: 0,
          withdrawn: 0,
        };
        for (const row of rows) acc[row.status] = row.count;
        return acc;
      });
    },
    setAuthors(paperId, authorList) {
      const work = async (): Promise<void> => {
        await db.delete(paperAuthors).where(eq(paperAuthors.paperId, paperId));
        if (authorList.length > 0) {
          await db.insert(paperAuthors).values(
            authorList.map((a) => ({
              ...a,
              paperId,
              affiliationRor: a.affiliationRor ?? null,
              creditRoles: a.creditRoles ?? [],
            })),
          );
        }
      };
      return fromPromise(work(), (cause) => Errors.internal('papers.setAuthors', cause));
    },
    setCategories(paperId, primary, secondary) {
      // Persist two views of category membership in the same transaction:
      //
      //   (a) `paper_categories` (m2m) — legacy. Read by anything joining
      //       on the table (older topic queries, OAI list-sets).
      //   (b) `papers.cross_listings` (text[]) — fast path for feed/topic
      //       queries that need a single-row scan. Capped at 5, dedup'd,
      //       primary excluded.
      //
      // Both stay in sync as long as setCategories is the only writer.
      // The CHECK constraints from migration 0021 guard the array form
      // even if a future caller forgets the dedup/cap.
      const work = async (): Promise<void> => {
        const deduped = Array.from(new Set(secondary.filter((c) => c !== primary))).slice(0, 5);
        await db.transaction(async (tx) => {
          await tx.delete(paperCategories).where(eq(paperCategories.paperId, paperId));
          const rows = [
            { paperId, categoryCode: primary, isPrimary: true },
            ...deduped.map((c) => ({ paperId, categoryCode: c, isPrimary: false })),
          ];
          await tx.insert(paperCategories).values(rows);
          await tx
            .update(papers)
            .set({ primaryCategory: primary, crossListings: deduped, updatedAt: new Date() })
            .where(eq(papers.id, paperId));
        });
      };
      return fromPromise(work(), (cause) => Errors.internal('papers.setCategories', cause));
    },
    setKeywords(paperId, keywords) {
      const work = async (): Promise<void> => {
        await db.delete(paperKeywords).where(eq(paperKeywords.paperId, paperId));
        if (keywords.length > 0) {
          await db
            .insert(paperKeywords)
            .values(keywords.map((keyword, position) => ({ paperId, keyword, position })));
        }
      };
      return fromPromise(work(), (cause) => Errors.internal('papers.setKeywords', cause));
    },
    addVersion(input) {
      return fromPromise(
        db.insert(paperVersions).values(input).returning(),
        (cause) => Errors.internal('papers.addVersion', cause),
      ).map(oneRow('papers.addVersion'));
    },
    latestVersion(paperId) {
      return fromPromise(
        db
          .select()
          .from(paperVersions)
          .where(eq(paperVersions.paperId, paperId))
          .orderBy(desc(paperVersions.versionNumber))
          .limit(1),
        (cause) => Errors.internal('papers.latestVersion', cause),
      ).map((rows) => rows[0] ?? null);
    },
    setHtmlKey(versionId, htmlKey) {
      return fromPromise(
        db
          .update(paperVersions)
          .set({ htmlKey })
          .where(eq(paperVersions.id, versionId))
          .returning(),
        (cause) => Errors.internal('papers.setHtmlKey', cause),
      ).map(oneRow('papers.setHtmlKey'));
    },
    allVersions(paperId) {
      return fromPromise(
        db
          .select()
          .from(paperVersions)
          .where(eq(paperVersions.paperId, paperId))
          .orderBy(desc(paperVersions.versionNumber)),
        (cause) => Errors.internal('papers.allVersions', cause),
      );
    },
    firstVersion(paperId) {
      return fromPromise(
        db
          .select()
          .from(paperVersions)
          .where(and(eq(paperVersions.paperId, paperId), eq(paperVersions.versionNumber, 1)))
          .limit(1),
        (cause) => Errors.internal('papers.firstVersion', cause),
      ).map((rows) => rows[0] ?? null);
    },
    setBridgeResult(versionId, fields) {
      return fromPromise(
        db
          .update(paperVersions)
          .set({
            bridgeStatus: fields.status,
            bskyPostUri: fields.bskyPostUri ?? null,
            bskyPostCid: fields.bskyPostCid ?? null,
            bridgeError: fields.error ?? null,
            bridgeAttemptedAt: new Date(),
          })
          .where(eq(paperVersions.id, versionId))
          .returning(),
        (cause) => Errors.internal('papers.setBridgeResult', cause),
      ).map(oneRow('papers.setBridgeResult'));
    },
    appendBridgeReply(versionId, reply) {
      // Append-only update, ordered by claimIdx. We rely on the caller's
      // idempotency check so the SQL stays simple — just jsonb concat.
      return fromPromise(
        db
          .update(paperVersions)
          .set({
            bskyThreadReplies: sql`
              COALESCE(${paperVersions.bskyThreadReplies}, '[]'::jsonb)
              || ${JSON.stringify([reply])}::jsonb
            `,
          })
          .where(eq(paperVersions.id, versionId))
          .returning(),
        (cause) => Errors.internal('papers.appendBridgeReply', cause),
      ).map(oneRow('papers.appendBridgeReply'));
    },
    setMastodonPostResult(versionId, fields) {
      const update: Partial<NewPaperVersion> = {
        mastodonPostStatus: fields.status,
        ...(fields.statusId !== undefined ? { mastodonStatusId: fields.statusId } : {}),
        ...(fields.statusUrl !== undefined ? { mastodonStatusUrl: fields.statusUrl } : {}),
        mastodonPostError: fields.error ?? null,
        ...(fields.status === 'posted' ? { mastodonPostedAt: new Date() } : {}),
      };
      return fromPromise(
        db
          .update(paperVersions)
          .set(update)
          .where(eq(paperVersions.id, versionId))
          .returning(),
        (cause) => Errors.internal('papers.setMastodonPostResult', cause),
      ).map(oneRow('papers.setMastodonPostResult'));
    },
    setFinalPdf(versionId, fields) {
      return fromPromise(
        db
          .update(paperVersions)
          .set({
            finalPdfUrl: fields.url,
            finalPdfContentHash: fields.contentHash,
            finalPdfBuiltAt: new Date(),
          })
          .where(eq(paperVersions.id, versionId))
          .returning(),
        (cause) => Errors.internal('papers.setFinalPdf', cause),
      ).map(oneRow('papers.setFinalPdf'));
    },
    setVersionChangelog(versionId, fields) {
      return fromPromise(
        db
          .update(paperVersions)
          .set(fields)
          .where(eq(paperVersions.id, versionId))
          .returning(),
        (cause) => Errors.internal('papers.setVersionChangelog', cause),
      ).map(oneRow('papers.setVersionChangelog'));
    },
    upsertDisclosure(input) {
      const insertVals = {
        paperId: input.paperId,
        level: input.level,
        aiUsed: input.aiUsed,
        models: input.models,
        notes: input.notes ?? null,
        summaryAiGenerated: input.summaryAiGenerated ?? false,
        humanVerified: input.humanVerified ?? false,
        attestation: input.attestation,
        uri: input.uri ?? null,
      };
      return fromPromise(
        db
          .insert(disclosures)
          .values(insertVals)
          .onConflictDoUpdate({
            target: disclosures.paperId,
            set: {
              level: insertVals.level,
              aiUsed: insertVals.aiUsed,
              models: insertVals.models,
              notes: insertVals.notes,
              summaryAiGenerated: insertVals.summaryAiGenerated,
              humanVerified: insertVals.humanVerified,
              attestation: insertVals.attestation,
              uri: insertVals.uri,
            },
          })
          .returning(),
        (cause) => Errors.internal('papers.upsertDisclosure', cause),
      ).map(oneRow('papers.upsertDisclosure'));
    },
    getDisclosure(paperId) {
      return fromPromise(
        db.select().from(disclosures).where(eq(disclosures.paperId, paperId)).limit(1),
        (cause) => Errors.internal('papers.getDisclosure', cause),
      ).map((rows) => rows[0] ?? null);
    },
    upsertSummary(input) {
      const insertVals = {
        paperId: input.paperId,
        tier: input.tier,
        text: input.text,
        aiGenerated: input.aiGenerated,
        aiModel: input.aiModel ?? null,
        uri: input.uri ?? null,
      };
      return fromPromise(
        db
          .insert(summaries)
          .values(insertVals)
          .onConflictDoUpdate({
            target: [summaries.paperId, summaries.tier],
            set: {
              text: insertVals.text,
              aiGenerated: insertVals.aiGenerated,
              aiModel: insertVals.aiModel,
              uri: insertVals.uri,
            },
          })
          .returning(),
        (cause) => Errors.internal('papers.upsertSummary', cause),
      ).map(oneRow('papers.upsertSummary'));
    },
    getSummary(paperId, tier) {
      return fromPromise(
        db
          .select()
          .from(summaries)
          .where(and(eq(summaries.paperId, paperId), eq(summaries.tier, tier)))
          .limit(1),
        (cause) => Errors.internal('papers.getSummary', cause),
      ).map((rows) => rows[0] ?? null);
    },
    loadWithRelations(id) {
      const work = async (): Promise<PaperWithRelations | null> => {
        const paperRows = await db.select().from(papers).where(eq(papers.id, id)).limit(1);
        const paper = paperRows[0];
        if (!paper) return null;

        const [authorsRows, catRows, kwRows, versionRows, discRows, summaryRows, detectorRows] =
          await Promise.all([
            db
              .select()
              .from(paperAuthors)
              .where(eq(paperAuthors.paperId, id))
              .orderBy(paperAuthors.position),
            db.select().from(paperCategories).where(eq(paperCategories.paperId, id)),
            db
              .select()
              .from(paperKeywords)
              .where(eq(paperKeywords.paperId, id))
              .orderBy(paperKeywords.position),
            db
              .select()
              .from(paperVersions)
              .where(eq(paperVersions.paperId, id))
              .orderBy(desc(paperVersions.versionNumber))
              .limit(1),
            db.select().from(disclosures).where(eq(disclosures.paperId, id)).limit(1),
            db.select().from(summaries).where(eq(summaries.paperId, id)),
            db
              .select()
              .from(aiDetectorScores)
              .where(eq(aiDetectorScores.paperId, id))
              .orderBy(desc(aiDetectorScores.computedAt))
              .limit(1),
          ]);

        return {
          paper,
          authors: authorsRows,
          categories: catRows.map((c) => c.categoryCode),
          keywords: kwRows.map((k) => k.keyword),
          latestVersion: versionRows[0] ?? null,
          disclosure: discRows[0] ?? null,
          summaries: summaryRows,
          detectorScore: detectorRows[0] ?? null,
        };
      };
      return fromPromise(work(), (cause) => Errors.internal('papers.loadWithRelations', cause));
    },
    loadManyWithRelations(ids) {
      const work = async (): Promise<PaperWithRelations[]> => {
        if (ids.length === 0) return [];
        const uniq = Array.from(new Set(ids));
        const [
          paperRows,
          authorRows,
          catRows,
          kwRows,
          versionRows,
          discRows,
          summaryRows,
          detectorRows,
        ] = await Promise.all([
          db.select().from(papers).where(inArray(papers.id, uniq)),
          db
            .select()
            .from(paperAuthors)
            .where(inArray(paperAuthors.paperId, uniq))
            .orderBy(paperAuthors.position),
          db.select().from(paperCategories).where(inArray(paperCategories.paperId, uniq)),
          db
            .select()
            .from(paperKeywords)
            .where(inArray(paperKeywords.paperId, uniq))
            .orderBy(paperKeywords.position),
          db
            .select()
            .from(paperVersions)
            .where(inArray(paperVersions.paperId, uniq))
            .orderBy(desc(paperVersions.versionNumber)),
          db.select().from(disclosures).where(inArray(disclosures.paperId, uniq)),
          db.select().from(summaries).where(inArray(summaries.paperId, uniq)),
          db
            .select()
            .from(aiDetectorScores)
            .where(inArray(aiDetectorScores.paperId, uniq))
            .orderBy(desc(aiDetectorScores.computedAt)),
        ]);

        // Group children by paperId for O(1) lookup.
        const byId = new Map<string, PaperRecord>();
        for (const p of paperRows) byId.set(p.id, p);

        const authorsBy = new Map<string, PaperAuthorRecord[]>();
        for (const r of authorRows) {
          const arr = authorsBy.get(r.paperId) ?? [];
          arr.push(r);
          authorsBy.set(r.paperId, arr);
        }
        const catsBy = new Map<string, string[]>();
        for (const r of catRows) {
          const arr = catsBy.get(r.paperId) ?? [];
          arr.push(r.categoryCode);
          catsBy.set(r.paperId, arr);
        }
        const kwBy = new Map<string, string[]>();
        for (const r of kwRows) {
          const arr = kwBy.get(r.paperId) ?? [];
          arr.push(r.keyword);
          kwBy.set(r.paperId, arr);
        }
        // versionRows already DESC-ordered; first occurrence per paperId wins.
        const versionBy = new Map<string, PaperVersionRecord>();
        for (const r of versionRows) if (!versionBy.has(r.paperId)) versionBy.set(r.paperId, r);
        const discBy = new Map<string, DisclosureRecord>();
        for (const r of discRows) discBy.set(r.paperId, r);
        const summariesBy = new Map<string, SummaryRecord[]>();
        for (const r of summaryRows) {
          const arr = summariesBy.get(r.paperId) ?? [];
          arr.push(r);
          summariesBy.set(r.paperId, arr);
        }
        const detectorBy = new Map<string, AiDetectorScore>();
        for (const r of detectorRows) if (!detectorBy.has(r.paperId)) detectorBy.set(r.paperId, r);

        const out: PaperWithRelations[] = [];
        for (const id of ids) {
          const paper = byId.get(id);
          if (!paper) continue;
          out.push({
            paper,
            authors: authorsBy.get(id) ?? [],
            categories: catsBy.get(id) ?? [],
            keywords: kwBy.get(id) ?? [],
            latestVersion: versionBy.get(id) ?? null,
            disclosure: discBy.get(id) ?? null,
            summaries: summariesBy.get(id) ?? [],
            detectorScore: detectorBy.get(id) ?? null,
          });
        }
        return out;
      };
      return fromPromise(work(), (cause) => Errors.internal('papers.loadManyWithRelations', cause));
    },
  };
}
