import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import type { RetiredPubkeyEntry } from '@openxiv/db';
import { configuredServicePublicMultibase } from '../services/trust-passport-bundle.js';

/**
 * did:web resolver endpoints. These are NOT mounted under /api — the
 * paths are fixed by the did:web specification.
 *
 *   • GET /u/:subject/did.json    → per-user DID document
 *   • GET /.well-known/did.json   → org-level DID document
 *
 * The same documents are *also* served by the Astro web app at the same
 * paths (web is the canonical edge), but mounting them here keeps the
 * resolver alive even if the web container is rolling. Both endpoints
 * return identical bytes so external resolvers can't observe a skew.
 *
 * Timeout: 2s hard limit so a slow DB lookup doesn't tie up a connection
 * during a Bluesky discovery storm. On timeout we return 503 + Retry-After
 * rather than a partial doc.
 */

const DID_DOC_TIMEOUT_MS = 2000;
const SUBJECT_RE = /^[A-Za-z0-9._-]{3,200}$/;

export async function didWebRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get(
    '/u/:subject/did.json',
    {
      schema: { params: z.object({ subject: z.string().min(1).max(256) }) },
    },
    async (req, reply) => {
      const { subject } = req.params as { subject: string };

      // Subject must be `{provider}.{rest}` with provider ∈ {orcid,google,plc}
      // (plc is the shadow form used when we haven't migrated a Bluesky user
      // to did:plc resolution yet). Bare handles never hit this route — the
      // Astro app routes `/u/{handle}` separately.
      if (!SUBJECT_RE.test(subject)) {
        return reply.status(404).send({ kind: 'not_found' });
      }

      const canonicalDid = `did:web:openxiv.net:u:${subject}`;

      // 2s hard timeout — wrap the DB lookup with AbortController.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), DID_DOC_TIMEOUT_MS);
      try {
        // Two-stage lookup so a user whose primary identity migrated to
        // did:plc:* (via account-linking) still resolves on their
        // historical did:web URL: try the current row, then fall back to
        // any row that carries this DID in legacy_dids.
        const fromCurrent = await Promise.race([
          ctx.repos.users.findByDid(canonicalDid),
          new Promise<never>((_, rej) => {
            ac.signal.addEventListener('abort', () =>
              rej(Errors.internal('did-web.timeout')),
            );
          }),
        ]);
        if (!('isOk' in fromCurrent) || fromCurrent.isErr()) {
          return reply.status(503).header('retry-after', '5').send({ kind: 'unavailable' });
        }
        let user = fromCurrent.value;
        if (!user) {
          const fromLegacy = await ctx.repos.users.findByLegacyDid(canonicalDid);
          if (!fromLegacy.isErr() && fromLegacy.value) {
            user = fromLegacy.value;
          }
        }
        if (!user) {
          return reply.status(404).send({ kind: 'not_found' });
        }
        // Treat the user's canonical DID identity as the source of truth:
        // if they linked Bluesky and their primary is now `did:plc:*`, then
        // openxiv.net/u/{subject}/did.json should redirect to the plc.directory
        // DID Document rather than publish a stale shadow.
        if (user.did.startsWith('did:plc:')) {
          return reply
            .status(301)
            .header('location', `https://plc.directory/${user.did}`)
            .send({ redirectTo: `https://plc.directory/${user.did}` });
        }

        const publicBase = process.env['PUBLIC_WEB_BASE'] ?? 'https://openxiv.net';
        const doc = buildUserDidDoc({
          canonicalDid,
          publicBase,
          handle: user.handle,
          publicSigningKey: user.publicSigningKey,
          retiredPubkeys: user.retiredPubkeys ?? [],
        });

        const etag = `"k-${user.publicSigningKey?.slice(-12) ?? 'nokey'}-r${user.retiredPubkeys?.length ?? 0}"`;
        if (req.headers['if-none-match'] === etag) {
          return reply.status(304).send();
        }
        reply.header('content-type', 'application/json');
        reply.header('cache-control', 'public, max-age=300');
        reply.header('etag', etag);
        reply.header('access-control-allow-origin', '*');
        return reply.send(doc);
      } finally {
        clearTimeout(timer);
      }
    },
  );

  app.get('/.well-known/did.json', async (_req, reply) => {
    const publicBase = process.env['PUBLIC_WEB_BASE'] ?? 'https://openxiv.net';
    const doc = buildOrgDidDoc({ publicBase });
    reply.header('content-type', 'application/json');
    reply.header('cache-control', 'public, max-age=300');
    reply.header('access-control-allow-origin', '*');
    return reply.send(doc);
  });
}

/**
 * Build a per-user DID document with secp256k1 Multikey verificationMethod.
 * Exported for the Astro SSR route and unit tests.
 */
export function buildUserDidDoc(input: {
  canonicalDid: string;
  publicBase: string;
  handle: string | null;
  publicSigningKey: string | null;
  retiredPubkeys: RetiredPubkeyEntry[];
}): Record<string, unknown> {
  const verificationMethod: Array<Record<string, unknown>> = [];
  if (input.publicSigningKey) {
    verificationMethod.push({
      id: `${input.canonicalDid}#atproto`,
      type: 'Multikey',
      controller: input.canonicalDid,
      publicKeyMultibase: input.publicSigningKey,
    });
  }
  // Retired pubkeys get their own id so a verifier can spot which key
  // was used. We give them stable indices rather than timestamps because
  // an index never collides on idempotent re-serialisation.
  input.retiredPubkeys.forEach((rp, i) => {
    verificationMethod.push({
      id: `${input.canonicalDid}#retired-${i}`,
      type: 'Multikey',
      controller: input.canonicalDid,
      publicKeyMultibase: rp.multibase,
      retiredAt: rp.retiredAt,
      retiredReason: rp.reason,
    });
  });

  const alsoKnownAs: string[] = [];
  if (input.handle) alsoKnownAs.push(`${input.publicBase}/@${input.handle}`);
  alsoKnownAs.push(`${input.publicBase}/u/${input.canonicalDid.replace('did:web:openxiv.net:u:', '')}`);

  // Only the *active* key participates in authentication. Retired entries
  // are present for retroactive verification only.
  const activeAuth = input.publicSigningKey ? [`${input.canonicalDid}#atproto`] : [];

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/secp256k1-2019/v1',
    ],
    id: input.canonicalDid,
    alsoKnownAs,
    verificationMethod,
    authentication: activeAuth,
    assertionMethod: activeAuth,
    service: [
      {
        id: '#openxiv-profile',
        type: 'OpenXivProfile',
        serviceEndpoint: input.handle
          ? `${input.publicBase}/@${input.handle}`
          : `${input.publicBase}/u/${input.canonicalDid.replace('did:web:openxiv.net:u:', '')}`,
      },
      {
        id: '#openxiv-appview',
        type: 'OpenXivAppView',
        serviceEndpoint: input.publicBase,
      },
    ],
  };
}

/**
 * Org-level DID document for `did:web:openxiv.net`. Pulls a *service*
 * keypair from env (if provided) so the App View can sign its own
 * records. Without the env, no verificationMethod is emitted — the
 * resolver still functions, just without the App View's signing key
 * surfaced.
 */
export function buildOrgDidDoc(input: { publicBase: string }): Record<string, unknown> {
  const servicePubMultibase = configuredServicePublicMultibase();
  const verificationMethod: Array<Record<string, unknown>> = [];
  if (servicePubMultibase) {
    verificationMethod.push({
      id: 'did:web:openxiv.net#atproto',
      type: 'Multikey',
      controller: 'did:web:openxiv.net',
      publicKeyMultibase: servicePubMultibase,
    });
  }
  const authPath = servicePubMultibase ? ['did:web:openxiv.net#atproto'] : [];
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/secp256k1-2019/v1',
    ],
    id: 'did:web:openxiv.net',
    alsoKnownAs: [input.publicBase],
    verificationMethod,
    authentication: authPath,
    assertionMethod: authPath,
    service: [
      { id: '#openxiv-app', type: 'OpenXivAppView', serviceEndpoint: input.publicBase },
      { id: '#openxiv-api', type: 'OpenXivApi', serviceEndpoint: input.publicBase },
      {
        id: '#bsky-fg',
        type: 'BskyFeedGenerator',
        serviceEndpoint: process.env['FEED_GENERATOR_PUBLIC_URL'] ?? input.publicBase,
      },
    ],
  };
}

export const __testing = { buildUserDidDoc, buildOrgDidDoc, SUBJECT_RE };
