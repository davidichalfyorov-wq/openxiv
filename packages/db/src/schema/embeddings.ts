import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { papers } from './papers.js';

/**
 * Per-paper text embedding for semantic recommendations. Dimension 768 matches
 * Gemini text-embedding-004's default output size.
 */
export const paperEmbeddings = pgTable(
  'paper_embeddings',
  {
    paperId: uuid('paper_id')
      .primaryKey()
      .references(() => papers.id, { onDelete: 'cascade' }),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    model: text('model').notNull(),
    dim: integer('dim').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hnswIdx: index('paper_embeddings_hnsw_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  }),
);

/**
 * Section-level embeddings — one row per ~1k-token chunk. Used for full-text
 * semantic search with paragraph-level context.
 */
export const paperSections = pgTable(
  'paper_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    sectionIdx: integer('section_idx').notNull(),
    title: text('title'),
    anchor: text('anchor'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    paperIdx: index('paper_sections_paper_idx').on(t.paperId),
    hnswIdx: index('paper_sections_hnsw_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
    uniq: uniqueIndex('paper_sections_unique').on(t.paperId, t.sectionIdx),
  }),
);
