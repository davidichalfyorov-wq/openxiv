import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authRoutes } from './auth.js';
import { authMastodonRoutes } from './auth-mastodon.js';
import { didWebRoutes } from './did-web.js';
import { handleRoutes } from './handle.js';
import { meKeyRoutes } from './me-keys.js';
import { accountLinkingRoutes } from './account-linking.js';
import { analyticsRoutes } from './analytics.js';
import { figuresRoutes } from './figures.js';
import { bskyFeedsRoutes } from './bsky-feeds.js';
import { bskyFeedGeneratorRoutes } from './bsky-feed-generator.js';
import { bskyFollowsRoutes } from './bsky-follows.js';
import { bskyLabelerRoutes } from './bsky-labeler.js';
import { bskyStarterPackRoutes } from './bsky-starter-pack.js';
import { discussionRoutes } from './discussion.js';
import { paperEditRoutes } from './paper-edit.js';
import { dailyBriefRoutes } from './daily-brief.js';
import { endorsementsRoutes } from './endorsements.js';
import { engagementRoutes } from './engagement.js';
import { eventsRoutes } from './events.js';
import { featuredRoutes } from './featured.js';
import { feedRoutes } from './feed.js';
import { followsRoutes } from './follows.js';
import { healthRoutes } from './health.js';
import { intakeRoutes } from './intake.js';
import { launchKitRoutes } from './launch-kit.js';
import { lensRoutes } from './lens.js';
import { mockStorageRoutes } from './mock-storage.js';
import { moderationRoutes } from './moderation.js';
import { meSubmissionsRoutes } from './me-submissions.js';
import { oaiPmhRoutes } from './oai-pmh.js';
import { papersRoutes } from './papers.js';
import { profileSettingsRoutes } from './profile-settings.js';
import { postsRoutes } from './posts.js';
import { preregRoutes } from './preregistrations.js';
import { refusalsRoutes } from './refusals.js';
import { profilesRoutes } from './profiles.js';
import { searchRoutes } from './search.js';
import { statsRoutes } from './stats.js';
import { topicsRoutes } from './topics.js';
import { uploadsRoutes } from './uploads.js';
import { versionsRoutes } from './versions.js';

/**
 * Routes that are infrastructure / protocol-defined and live at their own
 * canonical paths — these are NOT served under /api/*:
 *   - /healthz, /health (k8s + monitoring conventions)
 *   - /oai-pmh (OAI protocol fixes the path)
 *   - /xrpc/* (AT-proto protocol fixes the path — labeler, etc.)
 *   - /auth/:provider/callback (OAuth providers redirect to a fixed URL)
 *   - /.well-known/* (web convention)
 */
async function registerInfraRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(mockStorageRoutes);
  await app.register(oaiPmhRoutes);
  await app.register(bskyLabelerRoutes); // /xrpc/com.atproto.label.queryLabels
  await app.register(bskyFeedGeneratorRoutes); // /xrpc/app.bsky.feed.*
  await app.register(didWebRoutes); // /u/:subject/did.json, /.well-known/did.json
}

/**
 * App routes that are served at BOTH the legacy unprefixed path AND the
 * canonical `/api/*` path. The dual-registration is a transitional state:
 * new code calls `/api/*`, legacy code (paper UI, OAuth callbacks) still
 * hits the unprefixed form. A future migration drops the unprefixed
 * registration after every caller has moved.
 */
async function registerAppRoutes(app: FastifyInstance): Promise<void> {
  await app.register(statsRoutes);
  await app.register(searchRoutes);
  await app.register(topicsRoutes);
  await app.register(eventsRoutes);
  await app.register(lensRoutes);
  await app.register(featuredRoutes);
  await app.register(dailyBriefRoutes);
  await app.register(bskyFeedsRoutes);
  await app.register(bskyFollowsRoutes);
  await app.register(bskyStarterPackRoutes);
  await app.register(authRoutes);
  await app.register(authMastodonRoutes);
  await app.register(papersRoutes);
  await app.register(uploadsRoutes);
  await app.register(intakeRoutes);
  await app.register(postsRoutes);
  await app.register(feedRoutes);
  await app.register(profilesRoutes);
  await app.register(followsRoutes);
  await app.register(preregRoutes);
  await app.register(endorsementsRoutes);
  await app.register(engagementRoutes);
  await app.register(versionsRoutes);
  await app.register(discussionRoutes);
  await app.register(refusalsRoutes);
  await app.register(launchKitRoutes);
  await app.register(profileSettingsRoutes);
  await app.register(paperEditRoutes);
  await app.register(moderationRoutes);
  await app.register(meSubmissionsRoutes);
  await app.register(handleRoutes);
  await app.register(meKeyRoutes);
  await app.register(accountLinkingRoutes);
  await app.register(analyticsRoutes);
  await app.register(figuresRoutes);
}

/**
 * Legacy unprefixed paths that we explicitly 410. The operator toggles
 * `OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT` to `0` after the migration
 * window; until then the dual mount handles traffic. The /auth callback
 * paths are EXEMPT — external IdPs have hardcoded redirect URIs.
 */
const LEGACY_PATH_PREFIXES = [
  '/profiles/',
  '/papers/',
  '/posts/',
  '/feed',
  '/follows/',
  '/endorsements/',
  '/versions/',
  '/discussion/',
  '/refusals/',
  '/preregistrations/',
  '/me/',
] as const;

function isLegacyPath(url: string): boolean {
  // Strip any querystring before matching.
  const path = url.split('?', 1)[0] ?? '';
  if (path.startsWith('/api/')) return false;
  if (path.startsWith('/auth/')) return false; // OAuth redirect URIs
  return LEGACY_PATH_PREFIXES.some((p) => path === p || path.startsWith(p));
}

/**
 * Install the 410-Gone middleware at the *root* scope. Mounting it
 * via `app.register(...)` would encapsulate the hook to its own
 * (empty) plugin context where it never fires — so we attach
 * directly with `addHook`. The hook runs ahead of route resolution
 * and short-circuits when the path matches a legacy prefix.
 */
function installLegacyGoneHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isLegacyPath(req.url)) return;
    reply
      .status(410)
      .header('content-type', 'application/json')
      .send({
        kind: 'deprecated',
        moved_to: '/api' + req.url,
        sunset_date: '2026-05-18',
      });
  });
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerInfraRoutes(app);

  // The flag toggle decides whether the legacy unprefixed surface remains
  // mounted. Default is *enabled* during the migration window; ops flips
  // it to '0' once every caller has moved to the /api/* form. We don't
  // route this through the FlagsService because that depends on Redis;
  // a routing-level decision must be fully synchronous at boot.
  const unprefixedEnabled = process.env['OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT'] !== '0';

  if (!unprefixedEnabled) {
    // 410 for legacy paths. Installed at the root scope (not via
    // app.register) so the onRequest hook fires on every request.
    installLegacyGoneHook(app);
  }

  // Canonical /api/* surface — what api.ts in the web client calls. Every
  // app route is reachable at /api/<path>.
  await app.register(registerAppRoutes, { prefix: '/api' });

  if (unprefixedEnabled) {
    // Legacy unprefixed surface — retained during the migration window
    // so existing OAuth callbacks (`/auth/:provider/callback`, hard-coded
    // at the IdP) still resolve. Phase 7 of the profile-fix rollout flips
    // OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT=0 to retire this surface.
    await app.register(registerAppRoutes);
  } else {
    // Even with the unprefixed app surface removed, /auth/* callbacks
    // *must* still work — the IdP redirect URI is registered at e.g.
    // ORCID/Google/Bluesky as `https://openxiv.net/auth/orcid/callback`.
    // Mount a narrow registration carrying only the auth surface.
    await app.register(authRoutes);
    await app.register(authMastodonRoutes);
  }
}
