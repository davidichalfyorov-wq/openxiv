import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { papers } from './papers.js';

/**
 * The whitelist of editable paper fields. Any mutation through the
 * moderator editor must name one of these; anything else is rejected at
 * the API layer (the `field` CHECK in migration 0022 is a backup).
 *
 * NOT in this set on purpose — `openxiv_id`, `submitter_did`, the version
 * chain, file shas — these are part of the paper's identity and a single
 * moderator should not be able to retroactively rewrite them.
 */
export const EDITABLE_PAPER_FIELDS = [
  'title',
  'abstract',
  'keywords',
  'primary_category',
  'cross_listings',
  'license',
] as const;
export type EditablePaperField = (typeof EDITABLE_PAPER_FIELDS)[number];

export const paperEdits = pgTable(
  'paper_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    editorDid: text('editor_did').notNull(),
    field: text('field').$type<EditablePaperField>().notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    reason: text('reason').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    paperIdx: index('paper_edits_paper_idx').on(t.paperId),
    editedAtIdx: index('paper_edits_edited_at_idx').on(t.editedAt),
  }),
);
