/**
 * Admin-only: link a Bluesky did:plc:* to an existing OpenXiv user
 * without going through the OAuth flow. Designed for the operator
 * post-deploy step that binds the owner's verified Bluesky DID to
 * their pre-existing ORCID account.
 *
 * USAGE:
 *   node /app/apps/api/dist/scripts/admin-link-bluesky.js \
 *     --user-id=<uuid> \
 *     --did=did:plc:<id> \
 *     [--handle=<bluesky handle>]
 *
 * The link is recorded with `linked_via='admin'` so the audit row
 * makes the manual intervention obvious. The reservation row for the
 * did:plc is released (pointed at the user) in the same step.
 *
 * Side effects:
 *   - users.did              ← did:plc:<id>     (priority bump from did:web)
 *   - users.legacy_dids      ← appended with old did:web canonical
 *   - users.bluesky_did      ← did:plc:<id>
 *   - users.did_resolution_status ← 'native'
 *   - account_links row inserted with linked_via='admin'
 *   - reserved_dids row updated to point at the user
 */
import 'dotenv/config';
import { parseEnv } from '@openxiv/shared';
import { buildContext } from '../context.js';
import { makeAccountLinkingService } from '../services/account-linking.js';

interface Args {
  userId: string;
  did: string;
  handle?: string;
}

function parseArgs(): Args {
  const out: Partial<Args> = {};
  for (const arg of process.argv.slice(2)) {
    const m = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const k = m[1]!;
    const v = m[2]!;
    if (k === 'user-id') out.userId = v;
    else if (k === 'did') out.did = v;
    else if (k === 'handle') out.handle = v;
  }
  if (!out.userId || !out.did) {
    console.error('usage: admin-link-bluesky --user-id=<uuid> --did=did:plc:<id> [--handle=<h>]');
    process.exit(2);
  }
  if (!out.did.startsWith('did:plc:')) {
    console.error('refusing to link a non-did:plc identifier; use the OAuth flow for did:web');
    process.exit(2);
  }
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = parseEnv(process.env);
  const ctx = await buildContext(env);
  const linking = makeAccountLinkingService(ctx);
  try {
    const result = await linking.link({
      userId: args.userId,
      provider: 'bluesky',
      subject: args.did,
      providerData: {
        did: args.did,
        ...(args.handle ? { displayName: args.handle } : {}),
      },
      linkedVia: 'admin',
    });
    if (result.isErr()) {
      console.error('link failed:', result.error.message);
      process.exit(1);
    }
    const r = result.value;
    switch (r.kind) {
      case 'linked':
        console.warn(`linked OK; user.did is now ${r.user.did}`);
        console.warn(`legacy_dids: ${r.user.legacyDids.join(', ')}`);
        return;
      case 'conflict':
        console.error(`conflict: this Bluesky DID is already bound to user ${r.existingUserId}`);
        process.exit(1);
        return;
      case 'reserved':
        console.error(`reserved for another user: ${r.reservedForUserId ?? 'unspecified'}`);
        process.exit(1);
        return;
      case 'unauthorized':
        console.error(`no such user ${args.userId}`);
        process.exit(1);
        return;
    }
  } finally {
    await ctx.shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
