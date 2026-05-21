import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const EXTERNAL_SOURCES = ['arxiv', 'biorxiv', 'medrxiv', 'ssrn', 'osf'] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export interface ExternalAuthor {
  name: string;
  affiliation?: string;
  orcid?: string;
}

export const externalPapers = pgTable(
  'external_papers',
  {
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    title: text('title').notNull(),
    authorsJson: jsonb('authors_json').$type<ExternalAuthor[]>().notNull().default(sql`'[]'::jsonb`),
    abstract: text('abstract'),
    categories: jsonb('categories').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    doi: text('doi'),
    url: text('url'),
    license: text('license'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    withdrawn: boolean('withdrawn').notNull().default(false),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    rawMetadata: jsonb('raw_metadata').$type<unknown>(),
    claimedByDid: text('claimed_by_did'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source, t.sourceId] }),
    fetchedIdx: index('external_papers_fetched_at_idx').on(t.fetchedAt),
    doiIdx: index('external_papers_doi_idx').on(t.doi),
  }),
);

export type ExternalPaperRecord = typeof externalPapers.$inferSelect;
export type NewExternalPaper = typeof externalPapers.$inferInsert;
