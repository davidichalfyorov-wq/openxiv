import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `text[]` column with a typed JS surface. drizzle's built-in
 * `text` array helpers don't play nicely with `.default(sql\`'{}'\`)` so
 * we wire a thin custom type instead.
 */
const textArray = customType<{ data: string[]; driverData: string[] }>({
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Retired pubkey entry persisted as JSONB on `users.retired_pubkeys`. */
export interface RetiredPubkeyEntry {
  multibase: string;
  retiredAt: string;
  reason: 'rotation' | 'compromise' | 'manual';
}

export const userRoleEnum = pgEnum('user_role', ['author', 'moderator', 'admin']);
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    did: text('did').notNull(),
    handle: text('handle'),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    orcid: text('orcid'),
    googleSub: text('google_sub'),
    blueskyDid: text('bluesky_did'),
    email: text('email'),
    role: userRoleEnum('role').notNull().default('author'),
    isAdminPromoted: boolean('is_admin_promoted').notNull().default(false),
    bio: text('bio'),
    /**
     * DIDs the user had previously. Populated when a user migrates from a
     * placeholder DID (e.g. `did:web:openxiv.local:*`) to their canonical
     * production form. Read by the profile route to issue 301 redirects so
     * bookmarks and PDS records that still reference the old DID resolve.
     */
    legacyDids: textArray('legacy_dids').notNull().default(sql`'{}'::text[]`),
    /**
     * Per-user signing key material, populated by migration 0024 and the
     * backfill script. `publicSigningKey` is multibase-encoded
     * (`z…`) and served verbatim in /u/{subject}/did.json. The private
     * counterpart is encrypted with XChaCha20-Poly1305 under the env KEK;
     * the nonce is stored alongside so identical keys yield distinct
     * ciphertexts. Nullable: existing rows backfill in batches.
     */
    publicSigningKey: text('public_signing_key'),
    encryptedSigningKey: bytea('encrypted_signing_key'),
    signingKeyNonce: bytea('signing_key_nonce'),
    /**
     * Curve. CHECK-constrained to ('secp256k1','ed25519','p256') so a
     * future FIPS migration only flips values rather than ALTERing the
     * column shape. secp256k1 is the AT-proto canonical.
     */
    keyType: text('key_type').notNull().default('secp256k1'),
    /**
     * Old pubkeys we keep in the DID Document for retroactive signature
     * verification. JSONB array of RetiredPubkeyEntry. Defaults to [].
     */
    retiredPubkeys: jsonb('retired_pubkeys')
      .$type<RetiredPubkeyEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Cache of the *Bluesky* user's current signing key (Multikey). Kept
     * fresh on a 1h cadence by the resolver; not authoritative — the
     * authoritative source is the user's did:plc DID Document on plc.directory.
     */
    blueskySigningKey: text('bluesky_signing_key'),
    /**
     * How the current DID was issued:
     *   'native'        — directly from the IdP
     *   'fallback_web'  — Bluesky resolver failed >3s, we issued did:web
     *   'migrated'      — moved from openxiv.local via migration 0025
     * CHECK-constrained; defaults to 'native' so existing rows are
     * implicitly considered native (no behaviour change).
     */
    didResolutionStatus: text('did_resolution_status').notNull().default('native'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    didIdx: uniqueIndex('users_did_idx').on(t.did),
    orcidIdx: uniqueIndex('users_orcid_idx').on(t.orcid),
    googleIdx: uniqueIndex('users_google_idx').on(t.googleSub),
    blueskyIdx: uniqueIndex('users_bluesky_idx').on(t.blueskyDid),
    handleIdx: uniqueIndex('users_handle_idx').on(t.handle),
    roleIdx: index('users_role_idx').on(t.role),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    tokenIdx: uniqueIndex('sessions_token_idx').on(t.tokenHash),
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export const oauthStates = pgTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    provider: text('provider').notNull(),
    codeVerifier: text('code_verifier'),
    nonce: text('nonce'),
    redirectAfter: text('redirect_after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    expIdx: index('oauth_states_exp_idx').on(t.expiresAt),
    provIdx: index('oauth_states_provider_idx').on(t.provider),
  }),
);

export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerDid: text('follower_did').notNull(),
    targetDid: text('target_did').notNull(),
    uri: text('uri'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: uniqueIndex('follows_pair_idx').on(t.followerDid, t.targetDid),
    targetIdx: index('follows_target_idx').on(t.targetDid),
  }),
);
