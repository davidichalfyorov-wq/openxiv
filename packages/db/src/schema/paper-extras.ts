import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { papers } from './papers.js';

/**
 * Curated paper labels (Ozone-style). Each label is editor-applied;
 * unique on (paper_id, label) so re-applying is a no-op.
 */
export const PAPER_LABEL_VALUES = [
  'needs-context',
  'beginner-readable',
  'high-disclosure',
  'question-led-to-revision',
  'featured-candidate',
] as const;
export type PaperLabelValue = (typeof PAPER_LABEL_VALUES)[number];

export const paperLabels = pgTable(
  'paper_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    label: text('label').$type<PaperLabelValue>().notNull(),
    appliedBy: text('applied_by').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex('paper_labels_unique_idx').on(t.paperId, t.label),
    paperIdx: index('paper_labels_paper_idx').on(t.paperId),
    labelIdx: index('paper_labels_label_idx').on(t.label),
  }),
);

/**
 * Author-linked artifacts (code / data / metadata-passport URLs).
 */
export const PAPER_ARTIFACT_TYPES = ['code', 'data', 'codemeta', 'cff', 'other'] as const;
export type PaperArtifactType = (typeof PAPER_ARTIFACT_TYPES)[number];

export const paperArtifacts = pgTable(
  'paper_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    artifactType: text('artifact_type').$type<PaperArtifactType>().notNull(),
    url: text('url').notNull(),
    parsedMetadata: jsonb('parsed_metadata').$type<Record<string, unknown> | null>(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    paperIdx: index('paper_artifacts_paper_idx').on(t.paperId),
    typeIdx: index('paper_artifacts_type_idx').on(t.artifactType),
  }),
);

/**
 * OpenAlex enrichment cache (1:1 with papers). related_works is an array
 * of `{id, title, doi}` projection records — we don't store the full
 * OpenAlex blob, just what we render.
 */
export interface OpenAlexRelatedWork {
  id: string;
  title: string;
  doi?: string;
}

export const paperEnrichment = pgTable('paper_enrichment', {
  paperId: uuid('paper_id')
    .primaryKey()
    .references(() => papers.id, { onDelete: 'cascade' }),
  openalexId: text('openalex_id'),
  relatedWorks: jsonb('related_works').$type<OpenAlexRelatedWork[]>().notNull(),
  topics: jsonb('topics').$type<string[]>().notNull(),
  institutions: jsonb('institutions').$type<string[]>().notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull().default('openalex'),
});

/**
 * CRediT contribution roles — 14-value enum per Open Research / Contributor
 * Taxonomy. Stored per-author as a jsonb array (additive: an author can
 * carry zero or more).
 */
export const CREDIT_ROLES = [
  'conceptualization',
  'data-curation',
  'formal-analysis',
  'funding-acquisition',
  'investigation',
  'methodology',
  'project-administration',
  'resources',
  'software',
  'supervision',
  'validation',
  'visualization',
  'writing-original-draft',
  'writing-review-editing',
] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];
