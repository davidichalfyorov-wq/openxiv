import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { papers } from './papers.js';

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uri: text('uri').notNull(),
    cid: text('cid'),
    authorDid: text('author_did').notNull(),
    text: text('text').notNull(),
    replyRootUri: text('reply_root_uri'),
    replyParentUri: text('reply_parent_uri'),
    embedPaperUri: text('embed_paper_uri'),
    embedExternal: jsonb('embed_external').$type<{ uri: string; title: string; description?: string }>(),
    tags: jsonb('tags').$type<string[]>(),
    langs: jsonb('langs').$type<string[]>(),
    pinnedByAuthor: boolean('pinned_by_author').notNull().default(false),
    label: text('label'),
    hiddenByMod: boolean('hidden_by_mod').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uriIdx: uniqueIndex('posts_uri_idx').on(t.uri),
    authorIdx: index('posts_author_idx').on(t.authorDid),
    replyParentIdx: index('posts_reply_parent_idx').on(t.replyParentUri),
    paperIdx: index('posts_embed_paper_idx').on(t.embedPaperUri),
    createdIdx: index('posts_created_idx').on(t.createdAt),
  }),
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uri: text('uri').notNull(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    reviewerDid: text('reviewer_did').notNull(),
    text: text('text').notNull(),
    verdict: text('verdict'),
    confidence: integer('confidence'),
    isReviewerExpert: text('is_reviewer_expert').notNull().default('false'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uriIdx: uniqueIndex('reviews_uri_idx').on(t.uri),
    paperIdx: index('reviews_paper_idx').on(t.paperId),
    reviewerIdx: index('reviews_reviewer_idx').on(t.reviewerDid),
  }),
);

export const endorsements = pgTable(
  'endorsements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uri: text('uri').notNull(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    endorserDid: text('endorser_did').notNull(),
    // Typed verb from app.openxiv.endorsement lexicon. Nullable so legacy
    // rows that pre-date migration 0008 can stay queryable; new submissions
    // are required to include a verb at the lexicon layer.
    verb: text('verb'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uriIdx: uniqueIndex('endorsements_uri_idx').on(t.uri),
    paperIdx: index('endorsements_paper_idx').on(t.paperId),
    pairIdx: uniqueIndex('endorsements_pair_idx').on(t.paperId, t.endorserDid),
    paperVerbIdx: index('endorsements_paper_verb_idx').on(t.paperId, t.verb),
  }),
);

export const citations = pgTable(
  'citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uri: text('uri').notNull(),
    fromUri: text('from_uri').notNull(),
    fromDid: text('from_did').notNull(),
    toPaperId: uuid('to_paper_id').references(() => papers.id, { onDelete: 'set null' }),
    toDoi: text('to_doi'),
    toArxivId: text('to_arxiv_id'),
    context: text('context'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uriIdx: uniqueIndex('citations_uri_idx').on(t.uri),
    fromIdx: index('citations_from_idx').on(t.fromUri),
    toPaperIdx: index('citations_to_paper_idx').on(t.toPaperId),
  }),
);
