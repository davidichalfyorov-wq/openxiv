import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { papers } from './papers.js';

/**
 * One row per extracted figure or table. Populated by the `pdf-figures`
 * worker after a paper finishes the finalize stage. Idempotent on the
 * natural key `(paperId, version, idx)`; the worker upserts so a retry
 * after a partial MinIO upload still converges.
 *
 * `bbox` is the verbatim GROBID coord tuple in PDF user-space units —
 * preserved so a later alt-text pass (Tier 4) can re-derive the crop
 * without re-running GROBID.
 */
export interface FigureBbox {
  p: number; // page (1-based, matching the `page` column)
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PAPER_FIGURE_TYPES = ['figure', 'table'] as const;
export type PaperFigureType = (typeof PAPER_FIGURE_TYPES)[number];

export const PAPER_FIGURE_EXTRACTION_SOURCES = ['source_archive', 'pdf_grobid'] as const;
export type PaperFigureExtractionSource = (typeof PAPER_FIGURE_EXTRACTION_SOURCES)[number];

export const PAPER_FIGURE_EXTRACTION_REASONS = [
  'source_archive_figures',
  'source_archive_no_figures',
  'pdf_grobid_figures',
  'pdf_grobid_no_figures',
] as const;
export type PaperFigureExtractionReason = (typeof PAPER_FIGURE_EXTRACTION_REASONS)[number];

export const paperFigures = pgTable(
  'paper_figures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    idx: integer('idx').notNull(),
    imageUrl: text('image_url').notNull(),
    caption: text('caption'),
    page: integer('page'),
    bbox: jsonb('bbox').$type<FigureBbox>(),
    type: text('type').$type<PaperFigureType>().notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    naturalIdx: uniqueIndex('paper_figures_paper_version_idx_idx').on(t.paperId, t.version, t.idx),
    paperIdx: index('paper_figures_paper_version_idx').on(t.paperId, t.version, t.idx),
    recentIdx: index('paper_figures_recent_extracted_idx').on(t.extractedAt),
  }),
);

export const paperFigureExtractions = pgTable(
  'paper_figure_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    source: text('source').$type<PaperFigureExtractionSource>().notNull(),
    reason: text('reason').$type<PaperFigureExtractionReason>().notNull(),
    figureCount: integer('figure_count').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    naturalIdx: uniqueIndex('paper_figure_extractions_paper_version_idx').on(t.paperId, t.version),
    paperIdx: index('paper_figure_extractions_paper_idx').on(t.paperId, t.version),
    completedIdx: index('paper_figure_extractions_completed_idx').on(t.completedAt),
  }),
);

export type PaperFigureRecord = typeof paperFigures.$inferSelect;
export type NewPaperFigure = typeof paperFigures.$inferInsert;
export type PaperFigureExtractionRecord = typeof paperFigureExtractions.$inferSelect;
export type NewPaperFigureExtraction = typeof paperFigureExtractions.$inferInsert;
