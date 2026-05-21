import type { UserRecord } from '@openxiv/db';
import type { AppContext } from '../context.js';
import { sanitizePlainText } from './sanitize.js';

export const BLUESKY_PROFILE_SYNC_MAX_AGE_MS = 5 * 60 * 1000;
export const BLUESKY_PROFILE_SYNC_TIMEOUT_MS = 5 * 1000;

interface SyncOptions {
  readonly now?: Date;
  readonly maxAgeMs?: number;
  readonly timeoutMs?: number;
}

interface BskyActorProfile {
  readonly handle?: string;
  readonly displayName?: string;
  readonly avatar?: string;
}

export async function syncBlueskyProfileBestEffort(
  ctx: AppContext,
  user: UserRecord,
  opts: SyncOptions = {},
): Promise<UserRecord> {
  const blueskyDid = user.blueskyDid;
  if (!blueskyDid) return user;

  const now = opts.now ?? new Date();
  const maxAgeMs = opts.maxAgeMs ?? BLUESKY_PROFILE_SYNC_MAX_AGE_MS;
  if (now.getTime() - user.updatedAt.getTime() < maxAgeMs) return user;

  const timeoutMs = opts.timeoutMs ?? BLUESKY_PROFILE_SYNC_TIMEOUT_MS;
  return Promise.race([
    refresh(ctx, user, blueskyDid),
    new Promise<UserRecord>((resolve) => setTimeout(() => resolve(user), timeoutMs).unref?.()),
  ]).catch(() => user);
}

async function refresh(
  ctx: AppContext,
  user: UserRecord,
  blueskyDid: string,
): Promise<UserRecord> {
  const session = await ctx.clients.bluesky.restoreSession(blueskyDid);
  if (session.isErr()) return user;

  const profileResult = await session.value.get<BskyActorProfile>('app.bsky.actor.getProfile', {
    actor: blueskyDid,
  });
  if (profileResult.isErr()) return user;

  const profile = profileResult.value;
  const displayName =
    typeof profile.displayName === 'string' && profile.displayName.trim().length > 0
      ? sanitizePlainText(profile.displayName) || user.displayName
      : user.displayName;
  const avatarUrl =
    typeof profile.avatar === 'string' && profile.avatar.trim().length > 0
      ? profile.avatar.trim()
      : user.avatarUrl;

  let handle =
    typeof profile.handle === 'string' && profile.handle.trim().length > 0
      ? sanitizePlainText(profile.handle).toLowerCase()
      : user.handle;
  if (handle && handle !== user.handle) {
    const existing = await ctx.repos.users.findByHandle(handle);
    if (existing.isErr() || (existing.value && existing.value.id !== user.id)) {
      handle = user.handle;
    }
  }

  const updated = await ctx.repos.users.upsertByDid({
    did: user.did,
    blueskyDid,
    displayName,
    ...(handle ? { handle } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  });
  return updated.isOk() ? updated.value : user;
}
