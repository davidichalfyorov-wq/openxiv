/**
 * Legacy Bluesky OAuth skeleton — superseded by the real
 * `@atproto/oauth-client-node`-based implementation in
 * `packages/clients/src/bluesky/`. Re-exported here only so existing imports
 * keep type-checking; new code should import `BlueskyAuthClient` from
 * `@openxiv/clients` directly.
 */
export type { BlueskyAuthClient, BlueskyAgentSession, BlobRef } from '../bluesky/interface.js';
export { makeBlueskyAuthClient, makeMockBlueskyAuthClient } from '../bluesky/client.js';
