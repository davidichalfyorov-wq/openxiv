import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { papers } from './papers.js';

export const REFUSAL_REASON_VALUES = ['slop', 'scope', 'duplicate', 'legal', 'other'] as const;
export type RefusalReason = (typeof REFUSAL_REASON_VALUES)[number];

export interface RefusalExample {
  /** Where in the paper (section, page, equation). Free-form. */
  section?: string;
  /** Concrete problem the moderator points at. */
  problem: string;
  /** Optional concrete fix the submitter could try. Empty if unfixable. */
  suggestion?: string;
}

export const refusalPackets = pgTable('refusal_packets', {
  paperId: uuid('paper_id')
    .primaryKey()
    .references(() => papers.id, { onDelete: 'cascade' }),
  reasonCategory: text('reason_category').notNull(),
  fixable: boolean('fixable').notNull().default(false),
  examples: jsonb('examples').$type<RefusalExample[]>().notNull().default(sql`'[]'::jsonb`),
  moderatorNote: text('moderator_note').notNull(),
  issuedByDid: text('issued_by_did').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  rescindedAt: timestamp('rescinded_at', { withTimezone: true }),
});

export type RefusalPacketRecord = typeof refusalPackets.$inferSelect;
export type NewRefusalPacket = typeof refusalPackets.$inferInsert;
