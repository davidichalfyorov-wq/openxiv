import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const paperStatusEnum = pgEnum('paper_status', [
  'draft',
  'compiling',
  'compile_failed',
  'pending_disclosure',
  'pending_review',
  'published',
  'withdrawn',
]);

export type PaperStatus = (typeof paperStatusEnum.enumValues)[number];

export const disclosureLevelEnum = pgEnum('disclosure_level', [
  'none',
  'assistant',
  'coauthor',
  'primary',
]);

export type DisclosureLevel = (typeof disclosureLevelEnum.enumValues)[number];

export const summaryTierEnum = pgEnum('summary_tier', ['school', 'undergrad', 'expert']);
export type SummaryTier = (typeof summaryTierEnum.enumValues)[number];

/**
 * Author Launch Kit — JSON blob on `papers` so authors can curate post-publish
 * artifacts (Bluesky thread drafts, reviewer-invite notes, figure alt-text)
 * without needing one column per artifact type.
 */
export interface LaunchKit {
  /** Bluesky thread the author wants the bridge to publish. Max ~5 posts. */
  bridgeThread?: string[];
  /** Free-form reviewer-invite notes the author wants surfaced. */
  reviewerInvites?: string[];
  /** Author-supplied alt text keyed by figure label/id (e.g. "fig-3"). */
  figureAltText?: Record<string, string>;
  /** Single-claim cards the author wants pinned to the abstract page. */
  claimCards?: Array<{ headline: string; supporting: string }>;
}

import { customType } from 'drizzle-orm/pg-core';

/**
 * text[] surface for drizzle. Reused with the bluesky module's identical
 * helper — we keep them per-schema-file so circular imports stay clean.
 */
const textArr = customType<{ data: string[]; driverData: string[] }>({
  dataType() {
    return 'text[]';
  },
  toDriver(value) {
    return value ?? [];
  },
  fromDriver(value) {
    return Array.isArray(value) ? value : [];
  },
});

export const papers = pgTable(
  'papers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    openxivId: text('openxiv_id'),
    uri: text('uri'),
    cid: text('cid'),
    submitterDid: text('submitter_did').notNull(),
    title: text('title').notNull(),
    abstract: text('abstract'),
    license: text('license').notNull(),
    primaryCategory: text('primary_category').notNull(),
    /**
     * Cross-listings — secondary categories the paper also belongs to.
     * Capped at 5 by a CHECK constraint (migration 0021); primary is
     * forbidden from appearing here too. Feed and topic queries use
     * `WHERE primary_category = $1 OR $1 = ANY(cross_listings)` and the
     * `papers_cross_listings_gin_idx` makes the second branch fast.
     */
    crossListings: textArr('cross_listings').notNull().default(sql`'{}'::text[]`),
    doi: text('doi'),
    status: paperStatusEnum('status').notNull().default('draft'),
    versionNote: text('version_note'),
    supersedesUri: text('supersedes_uri'),
    // Records which version of /terms the author accepted at submission
    // time. Null only for legacy rows from before the gate landed.
    submissionTermsVersion: text('submission_terms_version'),
    submissionTermsAcceptedAt: timestamp('submission_terms_accepted_at', { withTimezone: true }),
    oneHardQuestion: text('one_hard_question'),
    launchKit: jsonb('launch_kit').$type<LaunchKit>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => ({
    openxivIdIdx: uniqueIndex('papers_openxiv_id_idx').on(t.openxivId),
    uriIdx: uniqueIndex('papers_uri_idx').on(t.uri),
    doiIdx: uniqueIndex('papers_doi_idx').on(t.doi),
    submitterIdx: index('papers_submitter_idx').on(t.submitterDid),
    statusIdx: index('papers_status_idx').on(t.status),
    publishedIdx: index('papers_published_idx').on(t.publishedAt),
    primaryCatIdx: index('papers_primary_cat_idx').on(t.primaryCategory),
  }),
);

export const idCounters = pgTable(
  'id_counters',
  {
    subject: text('subject').notNull(),
    year: integer('year').notNull(),
    nextValue: integer('next_value').notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subject, t.year] }),
  }),
);

export const submissionSagas = pgTable('submission_sagas', {
  paperId: uuid('paper_id')
    .primaryKey()
    .references(() => papers.id, { onDelete: 'cascade' }),
  // S1: source compiled + version row created (was "ops_created")
  stagePaperPersisted: boolean('stage_paper_persisted').notNull().default(false),
  // S2: paper approved → pending_review (was "ops_approved"; auto-approve in single-instance MVP)
  stagePaperApproved: boolean('stage_paper_approved').notNull().default(false),
  stageIdAssigned: boolean('stage_id_assigned').notNull().default(false),
  stagePdsPaper: boolean('stage_pds_paper').notNull().default(false),
  stagePdsSummaryDisclosure: boolean('stage_pds_summary_disclosure').notNull().default(false),
  stageBlueskyBridge: boolean('stage_bluesky_bridge').notNull().default(false),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  lastErrorStage: text('last_error_stage'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const paperCategories = pgTable(
  'paper_categories',
  {
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    categoryCode: text('category_code').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.paperId, t.categoryCode] }),
    catIdx: index('paper_categories_cat_idx').on(t.categoryCode),
  }),
);

export const paperKeywords = pgTable(
  'paper_keywords',
  {
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    keyword: text('keyword').notNull(),
    position: integer('position').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.paperId, t.keyword] }),
  }),
);

export const paperAuthors = pgTable(
  'paper_authors',
  {
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    did: text('did'),
    displayName: text('display_name').notNull(),
    orcid: text('orcid'),
    affiliation: text('affiliation'),
    /**
     * Research Organization Registry (ROR) identifier for the author's
     * affiliation. Populated by the wizard's ROR autocomplete when it
     * succeeds; null otherwise. Used by OpenAlex enrichment to match
     * institutions across our records and theirs.
     */
    affiliationRor: text('affiliation_ror'),
    /**
     * CRediT contribution roles for the author. Free-form jsonb because
     * the enum lives in `paper-extras.ts` (CREDIT_ROLES); we don't
     * pgEnum it so adding a role later doesn't require a migration.
     */
    creditRoles: jsonb('credit_roles')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isCorresponding: boolean('is_corresponding').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.paperId, t.position] }),
    didIdx: index('paper_authors_did_idx').on(t.did),
  }),
);

/**
 * `change_flags` jsonb shape — kept on this comment, not as a row type,
 * so we can add new flag keys without a migration. Drizzle's `$type<…>()`
 * is informational at runtime.
 */
export interface VersionChangeFlags {
  /** A core claim was changed (added, retracted, narrowed, broadened). */
  claim?: boolean;
  /** The method (algorithm, experimental design, proof technique) changed. */
  method?: boolean;
  /** Underlying data was added, removed, or re-derived. */
  data?: boolean;
  /** Reference list was updated (additions, corrections, removals). */
  refs?: boolean;
}

export const VERSION_BECAUSE_OF_VALUES = [
  'review',
  'comment',
  'self',
  'retraction_request',
] as const;
export type VersionBecauseOf = (typeof VERSION_BECAUSE_OF_VALUES)[number];

export const BRIDGE_STATUSES = ['none', 'pending', 'posted', 'failed', 'skipped'] as const;
export type BridgeStatus = (typeof BRIDGE_STATUSES)[number];

export const paperVersions = pgTable(
  'paper_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    pdfKey: text('pdf_key'),
    sourceKey: text('source_key'),
    htmlKey: text('html_key'),
    fileSha256: text('file_sha256'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    pageCount: integer('page_count'),
    changeFlags: jsonb('change_flags').$type<VersionChangeFlags>(),
    becauseOf: text('because_of'),
    unresolved: text('unresolved'),
    changelogNote: text('changelog_note'),
    diffUrl: text('diff_url'),
    // Bluesky bridge cross-post tracking. bskyPostUri/cid record the
    // at://did:plc:.../app.bsky.feed.post/<rkey> we wrote for this version;
    // v2+ replies thread off the v1 anchor. bridgeStatus is the saga's
    // observable view of what happened — a failed bridge is non-fatal but
    // recorded so an admin can re-trigger.
    bskyPostUri: text('bsky_post_uri'),
    bskyPostCid: text('bsky_post_cid'),
    bridgeStatus: text('bridge_status').$type<BridgeStatus>().notNull().default('none'),
    bridgeError: text('bridge_error'),
    bridgeAttemptedAt: timestamp('bridge_attempted_at', { withTimezone: true }),
    bskyThreadReplies: jsonb('bsky_thread_replies')
      .$type<Array<{ claimIdx: number; uri: string; cid: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    mastodonStatusId: text('mastodon_status_id'),
    mastodonStatusUrl: text('mastodon_status_url'),
    mastodonPostStatus: text('mastodon_post_status')
      .$type<'none' | 'pending' | 'posted' | 'failed' | 'skipped'>()
      .notNull()
      .default('none'),
    mastodonPostError: text('mastodon_post_error'),
    mastodonPostedAt: timestamp('mastodon_posted_at', { withTimezone: true }),
    /**
     * URL of the finalised PDF — the original `pdf_key` upload after the
     * pdf-finalize worker has stamped the left sidebar and prepended the
     * OpenXiv cover page. NULL until the worker has run successfully;
     * the abs page falls back to `pdf_key` in that case.
     */
    finalPdfUrl: text('final_pdf_url'),
    finalPdfBuiltAt: timestamp('final_pdf_built_at', { withTimezone: true }),
    /**
     * SHA-256 of the input the finalise job actually consumed, plus the
     * DOI string at build time. Used to short-circuit re-runs when neither
     * the source PDF nor the DOI has changed.
     */
    finalPdfContentHash: text('final_pdf_content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => ({
    paperVersionIdx: uniqueIndex('paper_versions_paper_version_idx').on(
      t.paperId,
      t.versionNumber,
    ),
    bskyUriIdx: index('paper_versions_bsky_uri_idx').on(t.bskyPostUri),
    mastodonStatusIdx: index('paper_versions_mastodon_status_idx').on(t.mastodonStatusId),
  }),
);

export const summaries = pgTable(
  'summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    tier: summaryTierEnum('tier').notNull(),
    text: text('text').notNull(),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    aiModel: text('ai_model'),
    uri: text('uri'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueTier: uniqueIndex('summaries_paper_tier_idx').on(t.paperId, t.tier),
  }),
);

export const disclosures = pgTable(
  'disclosures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .unique()
      .references(() => papers.id, { onDelete: 'cascade' }),
    level: disclosureLevelEnum('level').notNull(),
    aiUsed: jsonb('ai_used').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    models: jsonb('models')
      .$type<Array<{ name: string; vendor?: string; version?: string; usage?: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    notes: text('notes'),
    summaryAiGenerated: boolean('summary_ai_generated').notNull().default(false),
    humanVerified: boolean('human_verified').notNull().default(false),
    attestation: text('attestation').notNull(),
    uri: text('uri'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    levelIdx: index('disclosures_level_idx').on(t.level),
  }),
);

export const explainerCache = pgTable(
  'explainer_cache',
  {
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    tier: summaryTierEnum('tier').notNull(),
    text: text('text').notNull(),
    aiModel: text('ai_model').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.paperId, t.tier] }),
  }),
);

export const aiDetectorScores = pgTable(
  'ai_detector_scores',
  {
    paperVersionId: uuid('paper_version_id')
      .primaryKey()
      .references(() => paperVersions.id, { onDelete: 'cascade' }),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    burstScore: integer('burst_score'),
    binocularsScore: integer('binoculars_score'),
    stylometricScore: integer('stylometric_score'),
    modelVersions: jsonb('model_versions').$type<Record<string, string>>(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    paperIdx: index('ai_detector_scores_paper_idx').on(t.paperId),
  }),
);

export const preregistrations = pgTable(
  'preregistrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uri: text('uri'),
    cid: text('cid'),
    authorDid: text('author_did').notNull(),
    paperId: uuid('paper_id').references(() => papers.id, { onDelete: 'set null' }),
    paperUri: text('paper_uri'),
    title: text('title'),
    primaryCategory: text('primary_category'),
    hypothesis: text('hypothesis').notNull(),
    methodPlan: text('method_plan').notNull(),
    expectedOutcome: text('expected_outcome').notNull(),
    attestation: text('attestation').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uriIdx: uniqueIndex('preregistrations_uri_idx').on(t.uri),
    authorIdx: index('preregistrations_author_idx').on(t.authorDid),
    paperIdx: index('preregistrations_paper_idx').on(t.paperId),
  }),
);
