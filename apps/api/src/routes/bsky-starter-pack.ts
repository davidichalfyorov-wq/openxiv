import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const STARTER_SUGGESTIONS = [
  {
    did: 'did:plc:chuorfc5xbxvtvn53cqjvmov',
    handle: 'physicsworld.com',
    label: 'Physics World',
    field: 'physics',
  },
  {
    did: 'did:plc:dzc7v5tlmra57rx46eiyu5pe',
    handle: 'perimeterinstitute.ca',
    label: 'Perimeter Institute',
    field: 'theoretical physics',
  },
  {
    did: 'did:plc:vrsppvjc5fysqnm2zshiirey',
    handle: 'nature.com',
    label: 'Nature',
    field: 'science',
  },
  {
    did: 'did:plc:vqgovau5gkirnk3ss5qwjdmz',
    handle: 'science.org',
    label: 'Science',
    field: 'science',
  },
  {
    did: 'did:plc:yqfmy2p54vqgekrcz5zzykhl',
    handle: 'esa.int',
    label: 'European Space Agency',
    field: 'space science',
  },
  {
    did: 'did:plc:546qgaw5whiyfktyiyzv4z3p',
    handle: 'newscientist.com',
    label: 'New Scientist',
    field: 'science news',
  },
] as const;

/**
 * Admin-only endpoint to publish an `app.bsky.graph.starterpack` record to
 * the admin's PDS. A starter pack on Bluesky is a curated bundle of
 * follows + feeds users can subscribe to in one click; OpenXiv ships one
 * named "Scientists on OpenXiv".
 *
 * We don't store the published record locally — the admin can re-publish
 * with the same name to update the pack. The Bluesky App View handles
 * ownership and visibility.
 */
export async function bskyStarterPackRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/bsky/starter-suggestions', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    return { items: STARTER_SUGGESTIONS };
  });

  app.post(
    '/admin/bsky/starter-packs',
    {
      schema: {
        body: z.object({
          name: z.string().min(2).max(50),
          description: z.string().min(10).max(300),
          listName: z.string().min(2).max(60).default('Scientists on OpenXiv'),
          dids: z.array(z.string().startsWith('did:')).min(1).max(150),
          feeds: z
            .array(z.string().startsWith('at://'))
            .max(10)
            .default([]),
        }),
      },
    },
    async (req, reply) => {
      const session = req.session;
      if (!session) {
        reply.status(401);
        return { error: 'unauthenticated' };
      }
      if (!ctx.env.ADMIN_DIDS.includes(session.did)) {
        reply.status(403);
        return { error: 'forbidden', message: 'admin only' };
      }
      const { name, description, listName, dids, feeds } = req.body as {
        name: string;
        description: string;
        listName: string;
        dids: string[];
        feeds: string[];
      };

      const sessionResult = await ctx.clients.bluesky.restoreSession(session.did);
      if (sessionResult.isErr()) {
        reply.status(503);
        return { error: 'session_unavailable', message: sessionResult.error.message };
      }
      const bsky = sessionResult.value;

      // 1. Create the actor list record. The starter pack references it by URI.
      const listRecord = {
        $type: 'app.bsky.graph.list',
        purpose: 'app.bsky.graph.defs#referencelist',
        name: listName,
        description: `Members of the ${name} starter pack on OpenXiv.`,
        createdAt: new Date().toISOString(),
      };
      const listWrite = await bsky.post<{ uri: string; cid: string }>(
        'com.atproto.repo.createRecord',
        {
          repo: bsky.did,
          collection: 'app.bsky.graph.list',
          record: listRecord,
        },
      );
      if (listWrite.isErr()) {
        reply.status(502);
        return { error: 'bsky_list_failed', message: listWrite.error.message };
      }
      const listUri = listWrite.value.uri;

      // 2. Add each DID as a listitem. Sequential to respect bsky rate limits.
      const memberFailures: string[] = [];
      for (const did of dids) {
        const itemRecord = {
          $type: 'app.bsky.graph.listitem',
          subject: did,
          list: listUri,
          createdAt: new Date().toISOString(),
        };
        const w = await bsky.post<{ uri: string; cid: string }>(
          'com.atproto.repo.createRecord',
          {
            repo: bsky.did,
            collection: 'app.bsky.graph.listitem',
            record: itemRecord,
          },
        );
        if (w.isErr()) memberFailures.push(did);
      }

      // 3. Create the starterpack record itself. It points at the list above.
      const packRecord = {
        $type: 'app.bsky.graph.starterpack',
        name,
        description,
        list: listUri,
        feeds: feeds.map((uri) => ({ uri })),
        createdAt: new Date().toISOString(),
      };
      const packWrite = await bsky.post<{ uri: string; cid: string }>(
        'com.atproto.repo.createRecord',
        {
          repo: bsky.did,
          collection: 'app.bsky.graph.starterpack',
          record: packRecord,
        },
      );
      if (packWrite.isErr()) {
        reply.status(502);
        return { error: 'bsky_pack_failed', message: packWrite.error.message };
      }

      return {
        ok: true,
        starterPackUri: packWrite.value.uri,
        starterPackCid: packWrite.value.cid,
        listUri,
        memberFailures,
        bskyDeepLink: deriveStarterPackDeepLink(packWrite.value.uri),
      };
    },
  );
}

/**
 * Convert an at://did:.../app.bsky.graph.starterpack/<rkey> into the public
 * bsky.app share URL. Exported for tests.
 */
export function deriveStarterPackDeepLink(uri: string): string | null {
  const m = /^at:\/\/(did:[^/]+)\/app\.bsky\.graph\.starterpack\/(.+)$/.exec(uri);
  if (!m) return null;
  return `https://bsky.app/starter-pack/${encodeURIComponent(m[1]!)}/${encodeURIComponent(m[2]!)}`;
}
