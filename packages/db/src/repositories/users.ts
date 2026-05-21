import { and, asc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  sessions,
  users,
  type UserRole,
  type RetiredPubkeyEntry,
} from '../schema/users.js';

export type UserRecord = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type SessionRecord = typeof sessions.$inferSelect;

export interface UsersRepository {
  findById(id: string): AppResultAsync<UserRecord | null>;
  findByDid(did: string): AppResultAsync<UserRecord | null>;
  /**
   * Find a user by a DID stored in their `legacy_dids` array — i.e. a DID
   * the user used to have before a migration. The profiles route uses this
   * to issue 301 redirects from old URLs to the canonical form.
   */
  findByLegacyDid(did: string): AppResultAsync<UserRecord | null>;
  findByOrcid(orcid: string): AppResultAsync<UserRecord | null>;
  findByGoogleSub(googleSub: string): AppResultAsync<UserRecord | null>;
  findByHandle(handle: string): AppResultAsync<UserRecord | null>;
  upsertByDid(input: NewUser): AppResultAsync<UserRecord>;
  setRole(id: string, role: UserRole): AppResultAsync<void>;
  /**
   * Update handle for a user. UNIQUE constraint on `handle` makes this fail
   * with a Postgres error code 23505 if the candidate is already taken;
   * the caller is expected to translate that into a 409 response.
   */
  setHandle(id: string, handle: string): AppResultAsync<UserRecord>;
  /**
   * Write a fresh secp256k1 keypair onto a user row. The encrypted
   * private key + nonce travel together so a torn write never produces
   * an unrecoverable state (both columns are NOT NULL together or both
   * NULL together). Returns the updated user row.
   */
  setKeys(input: {
    id: string;
    publicSigningKey: string;
    encryptedSigningKey: Buffer;
    signingKeyNonce: Buffer;
    keyType?: 'secp256k1' | 'ed25519' | 'p256';
  }): AppResultAsync<UserRecord>;
  /** Replace the JSONB retired_pubkeys array. Used by the rotation flow. */
  setRetiredPubkeys(id: string, retired: RetiredPubkeyEntry[]): AppResultAsync<void>;
  /** Update the cached Bluesky signing key (from did:plc resolution). */
  setBlueskySigningKey(id: string, multibase: string | null): AppResultAsync<void>;
  /** Update the DID + resolution-status pair atomically. */
  setCanonicalDid(input: {
    id: string;
    did: string;
    resolutionStatus: 'native' | 'fallback_web' | 'migrated';
    appendLegacy?: string;
  }): AppResultAsync<UserRecord>;
  /** Linked Bluesky users whose cached profile row is older than `cutoff`. */
  listBlueskySyncCandidates(cutoff: Date, limit: number): AppResultAsync<UserRecord[]>;
  /**
   * Every user with `role='admin'`. Used to hydrate the in-memory admin
   * cache at API startup so `isAdminDid` is DB-driven without paying a
   * DB hit on each request.
   */
  listAdmins(): AppResultAsync<UserRecord[]>;
}

export function makeUsersRepository(db: Database): UsersRepository {
  return {
    findById(id) {
      return fromPromise(
        db.select().from(users).where(eq(users.id, id)).limit(1),
        (cause) => Errors.internal('users.findById', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByDid(did) {
      return fromPromise(
        db.select().from(users).where(eq(users.did, did)).limit(1),
        (cause) => Errors.internal('users.findByDid', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByLegacyDid(did) {
      // `users.legacy_dids` is a text[]; the GIN index makes ANY() O(log n).
      // We use the raw `@>` containment operator (`'{a,b}'::text[] @> ARRAY[$1]`)
      // because drizzle's array helpers don't expose it cleanly.
      return fromPromise(
        db
          .select()
          .from(users)
          .where(sql`${users.legacyDids} @> ARRAY[${did}]::text[]`)
          .limit(1),
        (cause) => Errors.internal('users.findByLegacyDid', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByOrcid(orcid) {
      return fromPromise(
        db.select().from(users).where(eq(users.orcid, orcid)).limit(1),
        (cause) => Errors.internal('users.findByOrcid', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByGoogleSub(googleSub) {
      return fromPromise(
        db.select().from(users).where(eq(users.googleSub, googleSub)).limit(1),
        (cause) => Errors.internal('users.findByGoogleSub', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByHandle(handle) {
      return fromPromise(
        db.select().from(users).where(eq(users.handle, handle)).limit(1),
        (cause) => Errors.internal('users.findByHandle', cause),
      ).map((rows) => rows[0] ?? null);
    },
    upsertByDid(input) {
      return fromPromise(
        db
          .insert(users)
          .values(input)
          .onConflictDoUpdate({
            target: users.did,
            set: {
              displayName: input.displayName,
              ...(input.orcid !== undefined ? { orcid: input.orcid } : {}),
              ...(input.googleSub !== undefined ? { googleSub: input.googleSub } : {}),
              ...(input.blueskyDid !== undefined ? { blueskyDid: input.blueskyDid } : {}),
              ...(input.handle !== undefined ? { handle: input.handle } : {}),
              ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
              ...(input.email !== undefined ? { email: input.email } : {}),
              updatedAt: new Date(),
            },
          })
          .returning(),
        (cause) => Errors.internal('users.upsertByDid', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(Promise.reject(new Error('insert returned no rows')), (c) =>
              Errors.internal('users.upsertByDid empty result', c),
            );
      });
    },
    setRole(id, role) {
      return fromPromise(
        db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)),
        (cause) => Errors.internal('users.setRole', cause),
      ).map(() => undefined);
    },
    setHandle(id, handle) {
      return fromPromise(
        db
          .update(users)
          .set({ handle, updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning(),
        (cause) => Errors.internal('users.setHandle', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(
              Promise.reject(new Error('user not found')),
              (_cause) => Errors.notFound('user'),
            );
      });
    },
    setKeys(input) {
      return fromPromise(
        db
          .update(users)
          .set({
            publicSigningKey: input.publicSigningKey,
            encryptedSigningKey: input.encryptedSigningKey,
            signingKeyNonce: input.signingKeyNonce,
            keyType: input.keyType ?? 'secp256k1',
            updatedAt: new Date(),
          })
          .where(eq(users.id, input.id))
          .returning(),
        (cause) => Errors.internal('users.setKeys', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(
              Promise.reject(new Error('user not found')),
              () => Errors.notFound('user'),
            );
      });
    },
    setRetiredPubkeys(id, retired) {
      return fromPromise(
        db
          .update(users)
          .set({ retiredPubkeys: retired, updatedAt: new Date() })
          .where(eq(users.id, id)),
        (cause) => Errors.internal('users.setRetiredPubkeys', cause),
      ).map(() => undefined);
    },
    setBlueskySigningKey(id, multibase) {
      return fromPromise(
        db
          .update(users)
          .set({ blueskySigningKey: multibase, updatedAt: new Date() })
          .where(eq(users.id, id)),
        (cause) => Errors.internal('users.setBlueskySigningKey', cause),
      ).map(() => undefined);
    },
    setCanonicalDid(input) {
      // Atomic update: did + resolution_status + append-into-legacy_dids
      // (if a previous DID existed and isn't already in the list).
      const setClause = input.appendLegacy
        ? {
            did: input.did,
            didResolutionStatus: input.resolutionStatus,
            legacyDids: sql`CASE WHEN ${users.legacyDids} @> ARRAY[${input.appendLegacy}]::text[]
              THEN ${users.legacyDids}
              ELSE array_append(${users.legacyDids}, ${input.appendLegacy})
            END`,
            updatedAt: new Date(),
          }
        : {
            did: input.did,
            didResolutionStatus: input.resolutionStatus,
            updatedAt: new Date(),
          };
      return fromPromise(
        db.update(users).set(setClause).where(eq(users.id, input.id)).returning(),
        (cause) => Errors.internal('users.setCanonicalDid', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(
              Promise.reject(new Error('user not found')),
              () => Errors.notFound('user'),
            );
      });
    },
    listBlueskySyncCandidates(cutoff, limit) {
      return fromPromise(
        db
          .select()
          .from(users)
          .where(and(isNotNull(users.blueskyDid), lt(users.updatedAt, cutoff)))
          .orderBy(asc(users.updatedAt))
          .limit(limit),
        (cause) => Errors.internal('users.listBlueskySyncCandidates', cause),
      );
    },
    listAdmins() {
      return fromPromise(
        db.select().from(users).where(eq(users.role, 'admin')),
        (cause) => Errors.internal('users.listAdmins', cause),
      );
    },
  };
}

export interface SessionsRepository {
  create(input: Omit<typeof sessions.$inferInsert, 'id'>): AppResultAsync<SessionRecord>;
  findActiveByTokenHash(tokenHash: string): AppResultAsync<SessionRecord | null>;
  revoke(id: string): AppResultAsync<void>;
}

export function makeSessionsRepository(db: Database): SessionsRepository {
  return {
    create(input) {
      return fromPromise(
        db.insert(sessions).values(input).returning(),
        (cause) => Errors.internal('sessions.create', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(Promise.reject(new Error('no row')), (c) =>
              Errors.internal('sessions.create empty', c),
            );
      });
    },
    findActiveByTokenHash(tokenHash) {
      return fromPromise(
        db
          .select()
          .from(sessions)
          .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
          .limit(1),
        (cause) => Errors.internal('sessions.findActiveByTokenHash', cause),
      ).map((rows) => {
        const row = rows[0];
        if (!row) return null;
        if (row.expiresAt.getTime() < Date.now()) return null;
        return row;
      });
    },
    revoke(id) {
      return fromPromise(
        db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.id, id), isNull(sessions.revokedAt))),
        (cause) => Errors.internal('sessions.revoke', cause),
      ).map(() => undefined);
    },
  };
}

// Avoid unused-import warning while keeping import for future use.
void or;
