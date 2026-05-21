import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Cryptographic and identity-related metadata layered onto `users` by
 * migration 0024.
 *
 * Three discrete concerns live in this file:
 *
 *   1. **reserved_dids** — a small registry of DIDs that may not be
 *      assigned to anyone other than `reserved_for_user_id`. Used to
 *      pre-reserve the owner's did:plc and to block infra/impersonation
 *      claims.
 *
 *   2. **account_links** — an append-only audit trail of OAuth provider
 *      ↔ user bindings, with the previous and resulting primary DIDs so
 *      an unlink can roll back cleanly.
 *
 *   3. Per-user signing keypair columns added directly to `users` (see
 *      the `users` schema file).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Provider strings we accept for OAuth bindings. */
export const ACCOUNT_LINK_PROVIDERS = ['orcid', 'google', 'bluesky', 'mastodon'] as const;
export type AccountLinkProvider = (typeof ACCOUNT_LINK_PROVIDERS)[number];

export const KEY_TYPES = ['secp256k1', 'ed25519', 'p256'] as const;
export type KeyType = (typeof KEY_TYPES)[number];

export const DID_RESOLUTION_STATUSES = ['native', 'fallback_web', 'migrated'] as const;
export type DidResolutionStatus = (typeof DID_RESOLUTION_STATUSES)[number];

/**
 * Retired public-key entries published in the DID Document so a signature
 * minted under the previous key still validates until it's purged. We
 * preserve `retiredAt` + `reason` so an operator can audit a rotation.
 */
export interface RetiredPubkey {
  multibase: string;
  retiredAt: string;
  reason: 'rotation' | 'compromise' | 'manual';
}

export const reservedDids = pgTable(
  'reserved_dids',
  {
    did: text('did').primaryKey(),
    reservedForUserId: uuid('reserved_for_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('reserved_dids_user_idx').on(t.reservedForUserId),
  }),
);

export const accountLinks = pgTable(
  'account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    linkedVia: text('linked_via').notNull(),
    prevPrimaryDid: text('prev_primary_did'),
    newPrimaryDid: text('new_primary_did').notNull(),
    mastodonInstanceUrl: text('mastodon_instance_url'),
    mastodonAccessToken: text('mastodon_access_token'),
    mastodonAccountUrl: text('mastodon_account_url'),
  },
  (t) => ({
    providerSubjectIdx: uniqueIndex('account_links_provider_subject_idx').on(
      t.provider,
      t.subject,
    ),
    userIdx: index('account_links_user_idx').on(t.userId),
  }),
);

export type ReservedDidRecord = typeof reservedDids.$inferSelect;
export type NewReservedDid = typeof reservedDids.$inferInsert;
export type AccountLinkRecord = typeof accountLinks.$inferSelect;
export type NewAccountLink = typeof accountLinks.$inferInsert;

// `bytea` is re-exported so other schema files can use the same custom
// type for binary-blob columns without redeclaring it.
export const _byteaType = bytea;
export { sql as _sql };
