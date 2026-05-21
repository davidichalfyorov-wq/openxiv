import { and, eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  accountLinks,
  reservedDids,
  type AccountLinkRecord,
  type NewAccountLink,
  type NewReservedDid,
  type ReservedDidRecord,
} from '../schema/identity.js';

/**
 * Read/write surface for the reserved-DIDs registry.
 *
 * The registry blocks impersonation and pre-reservation collisions: when
 * a fresh OAuth login produces a DID that's already in the table with
 * `reserved_for_user_id` set to *someone else* (or no one), the auth
 * service refuses to bind it. Once the legitimate owner links, the row
 * is updated so the user can actually use it.
 */
export interface ReservedDidsRepository {
  findByDid(did: string): AppResultAsync<ReservedDidRecord | null>;
  upsert(input: NewReservedDid): AppResultAsync<ReservedDidRecord>;
  releaseFor(userId: string, did: string): AppResultAsync<void>;
}

export function makeReservedDidsRepository(db: Database): ReservedDidsRepository {
  return {
    findByDid(did) {
      return fromPromise(
        db.select().from(reservedDids).where(eq(reservedDids.did, did)).limit(1),
        (cause) => Errors.internal('reservedDids.findByDid', cause),
      ).map((rows) => rows[0] ?? null);
    },
    upsert(input) {
      return fromPromise(
        db
          .insert(reservedDids)
          .values(input)
          .onConflictDoUpdate({
            target: reservedDids.did,
            set: {
              reservedForUserId: input.reservedForUserId,
              reason: input.reason,
            },
          })
          .returning(),
        (cause) => Errors.internal('reservedDids.upsert', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(
              Promise.reject(new Error('upsert returned no row')),
              (c) => Errors.internal('reservedDids.upsert empty', c),
            );
      });
    },
    releaseFor(userId, did) {
      // Used post-link: the legitimate owner has linked their reserved
      // DID, so we point the reservation at them. Idempotent.
      return fromPromise(
        db
          .update(reservedDids)
          .set({ reservedForUserId: userId, reason: 'owner_linked' })
          .where(eq(reservedDids.did, did)),
        (cause) => Errors.internal('reservedDids.releaseFor', cause),
      ).map(() => undefined);
    },
  };
}

/**
 * Append-only audit table for OAuth provider ↔ user bindings.
 *
 * UNIQUE(provider, subject) so a single ORCID/Google/Bluesky account
 * can never be bound to two openxiv users simultaneously — the
 * conflict triggers a 409 at the linking service. Inserts also record
 * the user's prior+next primary DID so unlink can restore state.
 */
export interface AccountLinksRepository {
  findByProviderSubject(
    provider: string,
    subject: string,
  ): AppResultAsync<AccountLinkRecord | null>;
  listForUser(userId: string): AppResultAsync<AccountLinkRecord[]>;
  insert(input: NewAccountLink): AppResultAsync<AccountLinkRecord>;
  update(id: string, input: Partial<NewAccountLink>): AppResultAsync<AccountLinkRecord>;
  delete(id: string): AppResultAsync<void>;
}

export function makeAccountLinksRepository(db: Database): AccountLinksRepository {
  return {
    findByProviderSubject(provider, subject) {
      return fromPromise(
        db
          .select()
          .from(accountLinks)
          .where(and(eq(accountLinks.provider, provider), eq(accountLinks.subject, subject)))
          .limit(1),
        (cause) => Errors.internal('accountLinks.findByProviderSubject', cause),
      ).map((rows) => rows[0] ?? null);
    },
    listForUser(userId) {
      return fromPromise(
        db
          .select()
          .from(accountLinks)
          .where(eq(accountLinks.userId, userId))
          .orderBy(accountLinks.linkedAt),
        (cause) => Errors.internal('accountLinks.listForUser', cause),
      );
    },
    insert(input) {
      return fromPromise(
        db.insert(accountLinks).values(input).returning(),
        (cause) => Errors.internal('accountLinks.insert', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(
              Promise.reject(new Error('insert returned no row')),
              (c) => Errors.internal('accountLinks.insert empty', c),
            );
      });
    },
    update(id, input) {
      return fromPromise(
        db.update(accountLinks).set(input).where(eq(accountLinks.id, id)).returning(),
        (cause) => Errors.internal('accountLinks.update', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(
              Promise.reject(new Error('update returned no row')),
              (c) => Errors.internal('accountLinks.update empty', c),
            );
      });
    },
    delete(id) {
      return fromPromise(
        db.delete(accountLinks).where(eq(accountLinks.id, id)),
        (cause) => Errors.internal('accountLinks.delete', cause),
      ).map(() => undefined);
    },
  };
}
