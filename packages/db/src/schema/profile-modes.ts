import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const PROFILE_MODES = ['author', 'reviewer', 'reader'] as const;
export type ProfileMode = (typeof PROFILE_MODES)[number];

export const profileModes = pgTable(
  'profile_modes',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    public: boolean('public').notNull().default(false),
    configJson: jsonb('config_json').$type<Record<string, unknown>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.mode] }),
    publicIdx: index('profile_modes_public_idx').on(t.mode, t.enabled, t.public),
  }),
);

export type ProfileModeRecord = typeof profileModes.$inferSelect;
export type NewProfileMode = typeof profileModes.$inferInsert;
