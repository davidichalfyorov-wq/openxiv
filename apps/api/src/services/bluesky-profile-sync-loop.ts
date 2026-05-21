import type { AppContext } from '../context.js';
import {
  BLUESKY_PROFILE_SYNC_MAX_AGE_MS,
  syncBlueskyProfileBestEffort,
} from './bluesky-profile-sync.js';

export interface BlueskyProfileSyncSummary {
  checked: number;
  refreshed: number;
}

export interface BlueskyProfileSyncOptions {
  now?: Date;
  maxAgeMs?: number;
  limit?: number;
}

export async function syncStaleBlueskyProfiles(
  ctx: AppContext,
  opts: BlueskyProfileSyncOptions = {},
): Promise<BlueskyProfileSyncSummary> {
  const now = opts.now ?? new Date();
  const maxAgeMs = opts.maxAgeMs ?? BLUESKY_PROFILE_SYNC_MAX_AGE_MS;
  const limit = opts.limit ?? 100;
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const candidates = await ctx.repos.users.listBlueskySyncCandidates(cutoff, limit);
  if (candidates.isErr()) throw candidates.error;

  let refreshed = 0;
  for (const user of candidates.value) {
    if (!user.blueskyDid) continue;
    const hasSession = await ctx.clients.bluesky.hasSession(user.blueskyDid);
    if (hasSession.isErr()) throw hasSession.error;
    if (!hasSession.value) continue;

    const next = await syncBlueskyProfileBestEffort(ctx, user, {
      now,
      maxAgeMs: 0,
    });
    if (next.updatedAt.getTime() !== user.updatedAt.getTime()) {
      refreshed += 1;
    }
  }
  return { checked: candidates.value.length, refreshed };
}

export function startBlueskyProfileSyncLoop(
  ctx: AppContext,
  opts: { intervalMs?: number; limit?: number } = {},
): { close(): void } {
  const intervalMs = opts.intervalMs ?? 60_000;
  let active = false;

  async function tick(): Promise<void> {
    if (active) return;
    active = true;
    try {
      const summary = await syncStaleBlueskyProfiles(ctx, { limit: opts.limit });
      if (summary.checked > 0) {
        console.warn(
          `[bluesky-profile-sync] checked=${summary.checked} refreshed=${summary.refreshed}`,
        );
      }
    } catch (err) {
      console.error('[bluesky-profile-sync] failed:', (err as Error).message);
    } finally {
      active = false;
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();

  return {
    close() {
      clearInterval(timer);
    },
  };
}
