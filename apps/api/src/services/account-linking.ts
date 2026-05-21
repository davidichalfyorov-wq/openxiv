import { Errors, type AppResultAsync, ResultAsync } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import type { UserRecord, AccountLinkRecord, NewAccountLink } from '@openxiv/db';
import { sanitizePlainText } from './sanitize.js';

/**
 * Account linking — bind multiple OAuth identities (ORCID + Google +
 * Bluesky) to the same OpenXiv user row.
 *
 * Three constraints govern the merge:
 *
 *   1. **Uniqueness** — `account_links` has UNIQUE(provider, subject). A
 *      provider account already bound to user X cannot be linked to user
 *      Y; the conflict returns 409 with both user_ids so an operator can
 *      reconcile.
 *
 *   2. **Reservation** — if the incoming Bluesky DID is present in
 *      `reserved_dids` and points to a different user, the link is
 *      rejected with 403.
 *
 *   3. **Primary-DID priority** — when multiple providers are bound to
 *      the same user, one DID wins as the primary identifier:
 *          did:plc:*                     > did:web:openxiv.net:u:orcid.*
 *          did:web:openxiv.net:u:orcid.* > did:web:openxiv.net:u:google.*
 *      The losing DIDs are appended to `legacy_dids` so the profile route
 *      can redirect them.
 *
 * Unlink is symmetric: a user with two providers can drop one, but
 * dropping the *only* provider is rejected (would leave the user with no
 * sign-in path). Dropping the primary requires promoting a non-primary
 * first.
 *
 * Audit: every link writes an append-only row to `account_links`
 * carrying `prev_primary_did` and `new_primary_did` so an unlink can
 * roll back state without consulting external services.
 */

export interface LinkProviderInput {
  userId: string;
  provider: 'orcid' | 'google' | 'bluesky' | 'mastodon';
  subject: string;
  /** Provider-supplied data we want to fold onto the user row. */
  providerData: {
    did?: string; // Bluesky did:plc
    displayName?: string;
    avatarUrl?: string;
    email?: string;
    orcid?: string;
  };
  providerSecrets?: {
    mastodonInstanceUrl?: string;
    mastodonAccessToken?: string;
    mastodonAccountUrl?: string;
  };
  /** Did the link originate from a fresh signup, a /link UI flow, or admin manual fix-up. */
  linkedVia: 'signup' | 'link' | 'admin';
}

export type LinkResult =
  | { kind: 'linked'; user: UserRecord; link: AccountLinkRecord }
  | { kind: 'conflict'; existingUserId: string }
  | { kind: 'reserved'; reservedForUserId: string | null }
  | { kind: 'unauthorized' };

export interface UnlinkInput {
  userId: string;
  provider: 'orcid' | 'google' | 'bluesky' | 'mastodon';
}

export type UnlinkResult =
  | { kind: 'unlinked'; user: UserRecord }
  | { kind: 'last_provider' }
  | { kind: 'primary_not_promoted'; primary: string }
  | { kind: 'not_linked' };

export interface AccountLinkingService {
  link(input: LinkProviderInput): AppResultAsync<LinkResult>;
  unlink(input: UnlinkInput): AppResultAsync<UnlinkResult>;
  listFor(userId: string): AppResultAsync<AccountLinkRecord[]>;
}

const PRIORITY: Record<string, number> = {
  // Higher wins.
  'did:plc:': 100,
  'did:web:openxiv.net:u:orcid.': 50,
  'did:web:openxiv.net:u:google.': 25,
  'did:web:openxiv.net:u:bluesky.': 10,
  'did:web:openxiv.net:u:mastodon.': 5,
};

export function didPriority(did: string): number {
  // Sort prefixes longest-first so e.g. 'did:web:openxiv.net:u:orcid.'
  // wins over 'did:web:'.
  const prefixes = Object.keys(PRIORITY).sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (did.startsWith(p)) return PRIORITY[p]!;
  }
  return 0;
}

function accountLinkSecretPatch(
  secrets: LinkProviderInput['providerSecrets'] | undefined,
): Partial<NewAccountLink> {
  if (!secrets) return {};
  return {
    ...(secrets.mastodonInstanceUrl ? { mastodonInstanceUrl: secrets.mastodonInstanceUrl } : {}),
    ...(secrets.mastodonAccessToken ? { mastodonAccessToken: secrets.mastodonAccessToken } : {}),
    ...(secrets.mastodonAccountUrl ? { mastodonAccountUrl: secrets.mastodonAccountUrl } : {}),
  };
}

export function makeAccountLinkingService(ctx: AppContext): AccountLinkingService {
  const { users, accountLinks, reservedDids } = ctx.repos;

  return {
    link(input) {
      return ResultAsync.fromPromise(
        (async (): Promise<LinkResult> => {
          // Step 1: provider/subject UNIQUE check.
          const existing = await accountLinks.findByProviderSubject(input.provider, input.subject);
          if (existing.isErr()) throw existing.error;
          if (existing.value && existing.value.userId !== input.userId) {
            return { kind: 'conflict', existingUserId: existing.value.userId };
          }
          if (existing.value) {
            const secretPatch = accountLinkSecretPatch(input.providerSecrets);
            let linkRow = existing.value;
            if (Object.keys(secretPatch).length > 0) {
              const updated = await accountLinks.update(existing.value.id, secretPatch);
              if (updated.isErr()) throw updated.error;
              linkRow = updated.value;
            }
            const userResult = await users.findById(input.userId);
            if (userResult.isErr()) throw userResult.error;
            const user = userResult.value;
            if (!user) return { kind: 'unauthorized' };
            return { kind: 'linked', user, link: linkRow };
          }

          // Step 2: reservation check (Bluesky only; ORCID/Google produce
          // did:web shapes that the reservation registry covers via the
          // canonical-DID-variant lookup below).
          if (input.provider === 'bluesky' && input.providerData.did) {
            const reservation = await reservedDids.findByDid(input.providerData.did);
            if (reservation.isErr()) throw reservation.error;
            const r = reservation.value;
            if (r && r.reservedForUserId && r.reservedForUserId !== input.userId) {
              return { kind: 'reserved', reservedForUserId: r.reservedForUserId };
            }
            // If reserved-for is NULL and we know who this is, treat it
            // as legitimate; the link below releases the reservation.
          }

          // Step 3: locate the target user row.
          const userResult = await users.findById(input.userId);
          if (userResult.isErr()) throw userResult.error;
          const user = userResult.value;
          if (!user) return { kind: 'unauthorized' };

          // Step 4: compute new primary DID. The incoming subject yields
          // a candidate DID; we pick whichever of (current, candidate)
          // has higher priority.
          const candidateDid =
            input.provider === 'bluesky' && input.providerData.did
              ? input.providerData.did
              : `did:web:openxiv.net:u:${input.provider}.${input.subject}`;

          const currentP = didPriority(user.did);
          const candidateP = didPriority(candidateDid);
          let newPrimary = user.did;
          let appendLegacy: string | undefined;
          let resolutionStatus: 'native' | 'fallback_web' | 'migrated' =
            user.didResolutionStatus as 'native' | 'fallback_web' | 'migrated';
          if (candidateP > currentP && candidateDid !== user.did) {
            newPrimary = candidateDid;
            appendLegacy = user.did;
            resolutionStatus = 'native';
          }

          if (newPrimary !== user.did) {
            const setResult = await users.setCanonicalDid({
              id: user.id,
              did: newPrimary,
              resolutionStatus,
              appendLegacy,
            });
            if (setResult.isErr()) throw setResult.error;
          }

          // Step 5: fold provider data onto the row WITHOUT clobbering
          // anything the user already curated (display_name is preserved
          // unless they had none; avatar_url likewise).
          const updatePatch: Partial<{
            orcid: string;
            googleSub: string;
            blueskyDid: string;
            displayName: string;
            avatarUrl: string | null;
          }> = {};
          if (input.provider === 'orcid' && input.providerData.orcid && !user.orcid) {
            updatePatch.orcid = input.providerData.orcid;
          }
          if (input.provider === 'google' && !user.googleSub) {
            updatePatch.googleSub = input.subject;
          }
          if (input.provider === 'bluesky' && !user.blueskyDid && input.providerData.did) {
            updatePatch.blueskyDid = input.providerData.did;
          }
          if (!user.displayName && input.providerData.displayName) {
            updatePatch.displayName = sanitizePlainText(input.providerData.displayName);
          }
          if (!user.avatarUrl && input.providerData.avatarUrl) {
            updatePatch.avatarUrl = input.providerData.avatarUrl;
          }
          if (Object.keys(updatePatch).length > 0) {
            const upsertResult = await users.upsertByDid({
              did: newPrimary,
              displayName: updatePatch.displayName ?? user.displayName,
              ...(updatePatch.orcid !== undefined ? { orcid: updatePatch.orcid } : {}),
              ...(updatePatch.googleSub !== undefined ? { googleSub: updatePatch.googleSub } : {}),
              ...(updatePatch.blueskyDid !== undefined ? { blueskyDid: updatePatch.blueskyDid } : {}),
              ...(updatePatch.avatarUrl !== undefined ? { avatarUrl: updatePatch.avatarUrl } : {}),
            });
            if (upsertResult.isErr()) throw upsertResult.error;
          }

          // Step 6: release reservation if applicable.
          if (input.provider === 'bluesky' && input.providerData.did) {
            const rel = await reservedDids.releaseFor(user.id, input.providerData.did);
            if (rel.isErr()) throw rel.error;
          }

          // Step 7: insert the audit row.
          const linkRow = await accountLinks.insert({
            userId: user.id,
            provider: input.provider,
            subject: input.subject,
            linkedVia: input.linkedVia,
            prevPrimaryDid: user.did,
            newPrimaryDid: newPrimary,
            ...accountLinkSecretPatch(input.providerSecrets),
          });
          if (linkRow.isErr()) throw linkRow.error;

          // Re-read the user row so the caller sees the post-link state.
          const fresh = await users.findById(user.id);
          if (fresh.isErr()) throw fresh.error;
          const freshRow = fresh.value;
          if (!freshRow) throw Errors.internal('user disappeared during link');

          return { kind: 'linked', user: freshRow, link: linkRow.value };
        })(),
        (cause) => Errors.internal('account-linking.link', cause),
      );
    },
    unlink(input) {
      return ResultAsync.fromPromise(
        (async (): Promise<UnlinkResult> => {
          const linksResult = await accountLinks.listForUser(input.userId);
          if (linksResult.isErr()) throw linksResult.error;
          const links = linksResult.value;
          const userResult = await users.findById(input.userId);
          if (userResult.isErr()) throw userResult.error;
          const user = userResult.value;
          if (!user) throw Errors.notFound('user');

          if (links.length === 0) return { kind: 'unlinked', user };
          const target = links.find((l: AccountLinkRecord) => l.provider === input.provider);
          if (!target) return { kind: 'unlinked', user };
          if (links.length === 1) return { kind: 'last_provider' };

          // Don't allow dropping the link whose subject is the user's
          // current primary DID — that would orphan the row. The user
          // must promote another provider first (which today means
          // contacting an admin; UI for self-service promotion deferred).
          if (target.prevPrimaryDid !== target.newPrimaryDid && user.did === target.newPrimaryDid) {
            return { kind: 'primary_not_promoted', primary: user.did };
          }

          const del = await accountLinks.delete(target.id);
          if (del.isErr()) throw del.error;
          const fresh = await users.findById(user.id);
          if (fresh.isErr()) throw fresh.error;
          const freshRow = fresh.value;
          if (!freshRow) throw Errors.notFound('user');
          return { kind: 'unlinked', user: freshRow };
        })(),
        (cause) => Errors.internal('account-linking.unlink', cause),
      );
    },
    listFor(userId) {
      return accountLinks.listForUser(userId);
    },
  };
}

export const __testing = { didPriority };
