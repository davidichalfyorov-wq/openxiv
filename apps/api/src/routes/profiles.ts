import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import type { UserRecord } from '@openxiv/db';
import { syncBlueskyProfileBestEffort } from '../services/bluesky-profile-sync.js';

/**
 * Tolerantly decode an identifier that may have been percent-encoded one or
 * more times en route to us. Real-world causes:
 *   - Legacy AT-proto records or bookmarks stored an already-encoded DID.
 *   - A pre-Phase-5 web build sent `did%253A…` because of the three-encode bug.
 *   - An upstream proxy normalised but didn't decode.
 *
 * We iterate `decodeURIComponent` until the string is stable or we've decoded
 * five times — adversarial `%2525252525…` chains cap at five rounds, then we
 * fall through with whatever we have and the lookup fails normally.
 *
 * Exported for tests.
 */
export function normalizeProfileIdentifier(raw: string): string {
  let current = raw;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Bad UTF-8 sequence — stop and let downstream lookup fail cleanly.
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Map a placeholder/legacy DID form to the canonical one. Returned alongside
 * the original so the lookup chain can try both. This is a code-side
 * mirror of the migration 0020 backfill — it lets the API surface keep
 * working even on a deploy that hasn't yet run the migration. Exported.
 */
export function canonicalDidVariants(did: string): readonly string[] {
  const trimmed = did.trim();
  // Strip "did:web:openxiv.local:..." → "did:web:openxiv.net:u:..."
  if (trimmed.startsWith('did:web:openxiv.local:')) {
    const suffix = trimmed.slice('did:web:openxiv.local:'.length);
    return [trimmed, `did:web:openxiv.net:u:${suffix}`];
  }
  return [trimmed];
}

export async function profilesRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get(
    '/profiles/:identifier',
    { schema: { params: z.object({ identifier: z.string().min(1).max(256) }) } },
    async (req, reply) => {
      const rawIdentifier = (req.params as { identifier: string }).identifier;
      // Step 1: decode-until-stable. The Fastify URL parser already
      // decodes once; this catches anything that arrived encoded twice
      // (the pre-Phase-5 production bug) or carried `%25` from a hand-
      // crafted client.
      const identifier = normalizeProfileIdentifier(rawIdentifier);

      // Lookup chain — each step is independent so a failure of one
      // doesn't block the others. The chain:
      //   (a) canonical DID lookup
      //   (b) canonical-variant DID lookup (legacy openxiv.local → openxiv.net)
      //   (c) legacy_dids array lookup
      //   (d) handle lookup (only when identifier doesn't start with did:)
      let user: UserRecord | null = null;
      let legacyHit = false;

      if (identifier.startsWith('did:')) {
        for (const candidate of canonicalDidVariants(identifier)) {
          const r = await ctx.repos.users.findByDid(candidate);
          if (r.isErr()) {
            // Don't propagate — try next candidate.
            req.log?.warn?.({ err: r.error.message, candidate }, 'profile findByDid failed');
            continue;
          }
          if (r.value) {
            user = r.value;
            legacyHit = candidate !== identifier; // re-pointed by variant rewrite
            break;
          }
        }
        if (!user) {
          const legacy = await ctx.repos.users.findByLegacyDid(identifier);
          if (!legacy.isErr() && legacy.value) {
            user = legacy.value;
            legacyHit = true;
          }
        }
      } else {
        const byHandle = await ctx.repos.users.findByHandle(identifier);
        if (byHandle.isErr()) throw byHandle.error;
        user = byHandle.value;
      }

      if (!user) throw Errors.notFound(`profile ${identifier}`);
      user = await syncBlueskyProfileBestEffort(ctx, user);

      if (legacyHit) {
        // 301 to the canonical URL so the next request hits the fast path
        // and any indexer/cache learns the canonical address. Prefer the
        // handle when present (pretty URL) and fall back to the canonical
        // DID when not.
        //
        // The target points at the /api/-prefixed surface (`/api/profiles/`).
        // The unprefixed form `/profiles/` is on its way out (Phase 7 flips
        // OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT=0 → 410 Gone), so emitting
        // it from a 301 would be self-harming.
        const canonicalSlug = user.handle ?? user.did;
        const target = `/api/profiles/${encodeURIComponent(canonicalSlug)}`;
        reply.header('location', target);
        reply.status(301);
        return { redirectTo: target, canonical: canonicalSlug };
      }
      return {
        id: user.id,
        did: user.did,
        handle: user.handle,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        orcid: user.orcid,
        role: user.role,
        bio: user.bio,
        legacyDids: user.legacyDids,
        createdAt: user.createdAt.toISOString(),
      };
    },
  );
}
