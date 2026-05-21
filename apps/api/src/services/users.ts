import { Errors, type AppError, type AppResultAsync, ResultAsync } from '@openxiv/shared';
import type { UserRecord } from '@openxiv/db';
import type { OAuthProfile } from '@openxiv/clients';
import type { AppContext } from '../context.js';
import { makeBlueskyDidResolver } from './bluesky-did-resolver.js';
import { syncBlueskyProfileBestEffort } from './bluesky-profile-sync.js';
import { sanitizePlainText } from './sanitize.js';

/**
 * DID-method strings. Exported so call sites never produce a free-form
 * string for the method — a typo at the call site becomes a typecheck
 * error instead of a silent unresolvable DID.
 */
export const DID_METHODS = ['did:web', 'did:plc', 'did:key'] as const;
export type DidMethod = (typeof DID_METHODS)[number];

export interface UsersService {
  upsertFromOAuth(profile: OAuthProfile): AppResultAsync<UserRecord>;
  getById(id: string): AppResultAsync<UserRecord>;
  getByDid(did: string): AppResultAsync<UserRecord>;
  /** Resolve a user by canonical DID OR any legacy DID they used to have. */
  findByAnyDid(did: string): AppResultAsync<UserRecord | null>;
  canSubmit(did: string): boolean;
  isAdminDid(did: string): boolean;
}

/**
 * Build the canonical DID for a freshly authenticated profile.
 *
 *   - Bluesky users keep their AT-proto DID (`did:plc:*`) untouched IF the
 *     resolver returns a fresh document within 3s. On resolver failure
 *     we fall back to a synthetic `did:web:openxiv.net:u:bluesky.<did>`
 *     and stamp `did_resolution_status='fallback_web'` so an operator
 *     can spot users who need re-resolution later.
 *   - ORCID/Google get `did:web:openxiv.net:u:{provider}.{subject}`,
 *     resolved via the per-path did:web at /u/{subject}/did.json.
 *
 * `openxiv.local` is no longer produced for ANY provider — that
 * placeholder was the pre-Phase 5 bug fingerprint and must never appear
 * on a new row.
 *
 * Pure helper exported so migrations and tests can call it directly.
 * For the async resolver-aware variant see `resolveCanonicalDid`.
 */
export function canonicalDidForProfile(profile: OAuthProfile): string {
  if (profile.provider === 'bluesky' && profile.did?.startsWith('did:plc:')) {
    return profile.did;
  }
  const subject = profile.subject.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `did:web:openxiv.net:u:${profile.provider}.${subject}`;
}

/**
 * Async variant: for Bluesky, verify the candidate did:plc resolves
 * within the resolver's 3s budget. Returns the canonical DID plus a
 * resolution status that the caller persists onto `users.did_resolution_status`.
 */
export interface ResolvedDid {
  did: string;
  status: 'native' | 'fallback_web';
}

export function resolveCanonicalDid(ctx: AppContext, profile: OAuthProfile): Promise<ResolvedDid> {
  return (async () => {
    if (profile.provider !== 'bluesky' || !profile.did?.startsWith('did:plc:')) {
      return { did: canonicalDidForProfile(profile), status: 'native' as const };
    }
    const resolver = makeBlueskyDidResolver(ctx);
    const r = await resolver.resolveDid(profile.did);
    if (r.isErr() || !r.value) {
      // Bluesky DID document didn't come back; degrade gracefully to
      // a did:web shadow so the user can still sign in. They lose AT-proto
      // write capability until the resolver recovers.
      return {
        did: `did:web:openxiv.net:u:bluesky.${profile.did.slice('did:plc:'.length)}`,
        status: 'fallback_web' as const,
      };
    }
    return { did: profile.did, status: 'native' as const };
  })();
}

/**
 * Slug rules: lowercase, ASCII alnum + hyphens, 3..30 chars, never starts or
 * ends with a hyphen. Empty / too-short result falls back to a stable
 * provider-derived id so we never persist NULL. Exported for tests.
 */
export function slugifyHandleCandidate(profile: OAuthProfile): string {
  const slug = sanitizePlainText(profile.displayName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+)|(-+$)/g, '')
    .slice(0, 30);
  if (slug.length >= 3) return slug;
  if (profile.provider === 'orcid' && profile.subject) {
    return `orcid-${profile.subject.replace(/-/g, '').slice(0, 14)}`;
  }
  if (profile.provider === 'google' && profile.subject) {
    return `g-${profile.subject.slice(0, 6)}`;
  }
  return `u-${profile.subject.slice(0, 8)}`;
}

const requireRow = <T>(row: T | null, msg: string): AppResultAsync<T> =>
  row !== null
    ? ResultAsync.fromSafePromise(Promise.resolve(row))
    : ResultAsync.fromPromise(Promise.reject(new Error(msg)), () => Errors.notFound(msg));

function findExistingOAuthUser(
  profile: OAuthProfile,
  users: AppContext['repos']['users'],
): AppResultAsync<UserRecord | null> {
  if (profile.provider === 'orcid') {
    return users.findByOrcid(profile.orcid ?? profile.subject);
  }
  if (profile.provider === 'google') {
    return users.findByGoogleSub(profile.subject);
  }
  return ResultAsync.fromSafePromise(Promise.resolve(null));
}

function primaryDidPriority(did: string): number {
  if (did.startsWith('did:plc:')) return 100;
  if (did.startsWith('did:web:openxiv.net:u:orcid.')) return 50;
  if (did.startsWith('did:web:openxiv.net:u:google.')) return 25;
  if (did.startsWith('did:web:openxiv.net:u:bluesky.')) return 10;
  if (did.startsWith('did:web:openxiv.net:u:mastodon.')) return 5;
  return 0;
}

const resolvedDid = (did: string, status: ResolvedDid['status']): ResolvedDid => ({
  did,
  status,
});

function reconcileOAuthIdentity(
  profile: OAuthProfile,
  users: AppContext['repos']['users'],
  did: string,
  status: ResolvedDid['status'],
): AppResultAsync<ResolvedDid> {
  return findExistingOAuthUser(profile, users).andThen((existing) => {
    if (!existing || existing.did === did) {
      return ResultAsync.fromSafePromise(Promise.resolve(resolvedDid(did, status)));
    }
    if (
      existing.legacyDids.includes(did) ||
      primaryDidPriority(existing.did) > primaryDidPriority(did)
    ) {
      return ResultAsync.fromSafePromise(Promise.resolve(resolvedDid(existing.did, 'native')));
    }
    return users.findByDid(did).andThen((target) => {
      if (target && target.id !== existing.id) {
        return ResultAsync.fromPromise(
          Promise.reject(new Error(`canonical DID ${did} belongs to user ${target.id}`)),
          () =>
            Errors.conflict('OAuth identity canonical DID already belongs to another user', {
              provider: profile.provider,
              subject: profile.subject,
              userId: existing.id,
              targetUserId: target.id,
            }),
        );
      }
      return users
        .setCanonicalDid({
          id: existing.id,
          did,
          resolutionStatus: status,
          appendLegacy: existing.did,
        })
        .map(() => resolvedDid(did, status));
    });
  });
}

function rejectAsync<T>(error: AppError): AppResultAsync<T> {
  return ResultAsync.fromPromise(Promise.reject(error), () => error);
}

function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (value instanceof Error) {
      parts.push(value.message);
      visit((value as { cause?: unknown }).cause);
      return;
    }
    if (typeof value === 'object') {
      const maybe = value as {
        message?: unknown;
        cause?: unknown;
        detail?: unknown;
        code?: unknown;
        constraint?: unknown;
      };
      if (typeof maybe.message === 'string') parts.push(maybe.message);
      if (typeof maybe.code === 'string') parts.push(maybe.code);
      if (typeof maybe.constraint === 'string') parts.push(maybe.constraint);
      visit(maybe.cause);
      visit(maybe.detail);
      return;
    }
    parts.push(String(value));
  };
  visit(error);
  return parts.join(' ');
}

function isUsersOrcidUniqueConflict(error: AppError): boolean {
  const text = collectErrorText(error);
  return (
    text.includes('users.upsertByDid') &&
    (text.includes('users_orcid_idx') || (text.includes('23505') && text.includes('orcid')))
  );
}

function recoverOrcidUniqueConflict(
  profile: OAuthProfile,
  users: AppContext['repos']['users'],
  error: AppError,
): AppResultAsync<UserRecord> {
  if (profile.provider !== 'orcid' || !isUsersOrcidUniqueConflict(error)) {
    return rejectAsync(error);
  }
  return users.findByOrcid(profile.orcid ?? profile.subject).andThen((existing) => {
    return existing
      ? ResultAsync.fromSafePromise(Promise.resolve(existing))
      : rejectAsync<UserRecord>(error);
  });
}

export function makeUsersService(ctx: AppContext): UsersService {
  const { users } = ctx.repos;
  const adminDids = new Set(ctx.env.ADMIN_DIDS);
  const submitAllowList = new Set(ctx.env.SUBMIT_ALLOW_DIDS);

  // Hydrate the admin set with any DB-promoted users — `role='admin'`
  // is the canonical surface (migration 0028 bootstraps the Owner this
  // way). The env value `ADMIN_DIDS` stays as a static fallback so an
  // operator can grant access without a DB write, but the DB row is
  // the production source of truth.
  //
  // Refresh policy: we don't refresh in-process. A role promotion via
  // SQL requires an API container restart to take effect — same TTL
  // as the env-driven set today. A future enhancement can wire a Redis
  // pub/sub channel for live invalidation.
  void users.listAdmins().then((r) => {
    if (r.isOk()) {
      for (const u of r.value) {
        adminDids.add(u.did);
        // Legacy DIDs that the same user used to have also count as
        // admin, so an old cookie or PDS link still authorises.
        for (const legacy of u.legacyDids ?? []) adminDids.add(legacy);
      }
    }
  });

  return {
    upsertFromOAuth(profile) {
      const displayName = sanitizePlainText(profile.displayName) || profile.subject;
      // Resolve the canonical DID. For Bluesky this involves a 3s
      // resolver call to plc.directory; on failure we degrade to a
      // did:web shadow and stamp resolution_status. For ORCID/Google
      // the call is synchronous-shaped (no network) but we use the
      // resolver path anyway to keep the type-flow uniform.
      return ResultAsync.fromPromise(resolveCanonicalDid(ctx, profile), (cause) =>
        Errors.internal('users.resolveDid', cause),
      )
        .andThen(({ did, status }) => reconcileOAuthIdentity(profile, users, did, status))
        .andThen(({ did, status }) => {
          const shouldPromote = adminDids.has(did);
          // Handle is NO LONGER auto-picked at signup. The Phase 3 welcome
          // flow collects it from the user. If a Bluesky profile carries
          // its own handle (e.g. ddavidich.bsky.social → 'ddavidich') we
          // accept it; otherwise we leave the column NULL and the header
          // link points to /auth/welcome.
          const explicitHandle =
            profile.handle && profile.handle.trim().length > 0
              ? sanitizePlainText(profile.handle).toLowerCase()
              : null;
          const handlePromise = explicitHandle
            ? resolveUniqueHandle(explicitHandle, users).map((h) => ({
                handle: h as string | null,
              }))
            : ResultAsync.fromSafePromise(Promise.resolve({ handle: null as string | null }));
          return handlePromise.andThen(({ handle }) =>
            users
              .upsertByDid({
                did,
                displayName,
                ...(handle ? { handle } : {}),
                ...(profile.email ? { email: profile.email } : {}),
                ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
                ...(profile.orcid ? { orcid: profile.orcid } : {}),
                ...(profile.provider === 'google' ? { googleSub: profile.subject } : {}),
                ...(profile.provider === 'bluesky' ? { blueskyDid: profile.subject } : {}),
                ...(shouldPromote ? { role: 'moderator' as const, isAdminPromoted: true } : {}),
              })
              .orElse((error) => recoverOrcidUniqueConflict(profile, users, error))
              .andThen((user) => {
                // Stamp resolution_status if it differs (e.g. fallback_web).
                if (status !== 'native' && user.didResolutionStatus !== status) {
                  return users
                    .setCanonicalDid({
                      id: user.id,
                      did: user.did,
                      resolutionStatus: status,
                    })
                    .map((u) => u);
                }
                return ResultAsync.fromSafePromise(Promise.resolve(user));
              })
              .andThen((user) =>
                // Seed default profile modes on first sign-in. `reader` is
                // on + public so a newly-registered user immediately shows
                // up on /u/{handle} as a recognisable profile. seedDefaults
                // is idempotent — second sign-in is a no-op.
                ctx.repos.profileModes
                  .seedDefaults(user.id)
                  .map(() => user)
                  .orElse(() => ResultAsync.fromSafePromise(Promise.resolve(user))),
              )
              .andThen((user) => {
                // Bootstrap a signing keypair for did:web users so their
                // /u/{subject}/did.json publishes a usable verificationMethod
                // from the very first request. did:plc users skip this — their
                // authoritative key lives on plc.directory. The call is
                // idempotent; on KEK misconfiguration it errors out and we
                // swallow so a missing KEK doesn't break sign-in. Operator
                // is alerted via the env-check at startup.
                if (user.did.startsWith('did:plc:')) {
                  return ResultAsync.fromSafePromise(Promise.resolve(user));
                }
                return ensureUserKeypair(ctx, user.id).map(() => user);
              })
              .andThen((user) => {
                if (shouldPromote && !user.isAdminPromoted) {
                  return users.setRole(user.id, 'moderator').map(() => ({
                    ...user,
                    role: 'moderator' as const,
                    isAdminPromoted: true,
                  }));
                }
                return ResultAsync.fromSafePromise(Promise.resolve(user));
              })
              .andThen((user) => {
                // Primary-signup forward fix: idempotently record an
                // account_links row for the provider+subject pair so
                // GET /api/me/links surfaces the binding even when the
                // sign-in flow was the user's first contact with the
                // service (i.e. no linkProvider step ever ran). The
                // UNIQUE(provider, subject) constraint makes this a
                // no-op on every subsequent sign-in.
                return ensureAccountLink(ctx, user.id, profile, user.did).map(() => user);
              }),
          );
        });
    },
    getById(id) {
      return users
        .findById(id)
        .andThen((u) => requireRow(u, `user ${id} not found`))
        .andThen((u) => ResultAsync.fromSafePromise(syncBlueskyProfileBestEffort(ctx, u)));
    },
    getByDid(did) {
      return users
        .findByDid(did)
        .andThen((u) => requireRow(u, `user ${did} not found`))
        .andThen((u) => ResultAsync.fromSafePromise(syncBlueskyProfileBestEffort(ctx, u)));
    },
    findByAnyDid(did) {
      // Fast path: did matches a canonical user record.
      return users.findByDid(did).andThen((primary) => {
        if (primary) return ResultAsync.fromSafePromise(Promise.resolve(primary));
        // Slow path: scan legacy_dids. Cheap because the GIN index makes
        // the array lookup O(log n).
        return users.findByLegacyDid(did);
      });
    },
    canSubmit(did) {
      if (submitAllowList.size === 0) return true; // open mode
      return submitAllowList.has(did) || adminDids.has(did);
    },
    isAdminDid(did) {
      return adminDids.has(did);
    },
  };
}

/**
 * Idempotently record an account_links row for a primary-signup OAuth
 * provider. The repo's `findByProviderSubject` is cheap (the unique
 * index on `(provider, subject)` makes it O(1)) so we don't risk an
 * insert-conflict path here — we look first, then insert only when
 * missing.
 *
 * `linked_via='primary_signup'` distinguishes these from explicit
 * /me/links/{provider} flows ('orcid'|'google'|'bluesky') and from the
 * 0029 backfill ('backfill') so an operator can audit the source.
 *
 * Errors are swallowed: if account_links is briefly unavailable the
 * user still signs in; the next sign-in will retry.
 */
function ensureAccountLink(
  ctx: AppContext,
  userId: string,
  profile: OAuthProfile,
  currentDid: string,
): AppResultAsync<void> {
  return ctx.repos.accountLinks
    .findByProviderSubject(profile.provider, profile.subject)
    .andThen((existing) => {
      if (existing) return ResultAsync.fromSafePromise(Promise.resolve(undefined));
      return ctx.repos.accountLinks
        .insert({
          userId,
          provider: profile.provider,
          subject: profile.subject,
          linkedVia: 'primary_signup',
          prevPrimaryDid: null,
          newPrimaryDid: currentDid,
        })
        .map(() => undefined);
    })
    .orElse(() => ResultAsync.fromSafePromise(Promise.resolve(undefined)));
}

/**
 * Best-effort keypair bootstrap. On KEK misconfiguration we swallow
 * the throw and let the user sign in without keys — the did.json will
 * publish without verificationMethod and the operator gets an
 * `OPENXIV_KEK_BASE64` error in logs they can act on.
 */
function ensureUserKeypair(
  ctx: AppContext,
  userId: string,
): AppResultAsync<{ rotated: boolean; publicMultibase: string }> {
  // The user-keys module reads OPENXIV_KEK_BASE64 lazily on each call,
  // so an env misconfiguration manifests as a thrown Error here. Wrap
  // the entire call in a try/catch via a thenable so the outer chain
  // sees a no-op success rather than a 500.
  return ResultAsync.fromPromise(
    (async () => {
      try {
        const { makeUserKeysService } = await import('./user-keys.js');
        const result = await makeUserKeysService(ctx).ensureKeypair(userId);
        if (result.isErr()) return { rotated: false, publicMultibase: '' };
        return result.value;
      } catch {
        return { rotated: false, publicMultibase: '' };
      }
    })(),
    (cause) => Errors.internal('users.ensureKeypair', cause),
  );
}

/**
 * Reserve a unique handle starting from a candidate. Iterates with a numeric
 * suffix until findByHandle returns null. We bound the attempt loop because
 * an attacker who registers thousands of variants of a popular handle could
 * otherwise make signup quadratic.
 *
 * Exported for tests via canonicalDidForProfile / slugifyHandleCandidate;
 * this function is internal but the unit test exercises it through
 * upsertFromOAuth.
 */
function resolveUniqueHandle(
  candidate: string,
  users: AppContext['repos']['users'],
): AppResultAsync<string> {
  const tryAt = (n: number, c: string): AppResultAsync<string> => {
    if (n > 50) {
      // Give up on the slug; fall back to an opaque id-suffix that's
      // guaranteed unique because of the random suffix. Should be unreachable
      // outside an adversarial collision pattern.
      const fallback = `${c.slice(0, 22)}-${Math.random().toString(36).slice(2, 8)}`;
      return ResultAsync.fromSafePromise(Promise.resolve(fallback));
    }
    return users.findByHandle(c).andThen((existing) => {
      if (!existing) return ResultAsync.fromSafePromise(Promise.resolve(c));
      const next = `${candidate}-${n}`;
      return tryAt(n + 1, next);
    });
  };
  return tryAt(1, candidate);
}
