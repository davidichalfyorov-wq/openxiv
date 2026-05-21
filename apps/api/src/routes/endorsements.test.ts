import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AppError, ResultAsync } from '@openxiv/shared';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppContext } from '../context.js';
import type { SessionPayload } from '../auth/session.js';
import { endorsementsRoutes } from './endorsements.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));

function appWithEndorsementContext(overrides: {
  sessionDid?: string;
  userDid?: string;
  blueskyDid?: string | null;
  legacyDids?: string[];
  submitterDid?: string;
  authorDids?: Array<string | null>;
}) {
  const sessionDid = overrides.sessionDid ?? 'did:web:openxiv.test:u:reader';
  const userDid = overrides.userDid ?? sessionDid;
  const upsert = vi.fn(() =>
    okAsync({
      id: 'endorsement-1',
      uri: 'at://did:plc:reader/app.openxiv.endorsement/tid',
      paperId: 'paper-1',
      endorserDid: overrides.blueskyDid ?? sessionDid,
      verb: 'useful_background',
      note: null,
      createdAt: new Date('2026-05-19T00:00:00Z'),
      updatedAt: new Date('2026-05-19T00:00:00Z'),
    }),
  );
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      reply.status(error.toStatusCode()).send(error.toJSON());
      return;
    }
    reply.status(500).send({ kind: 'internal', message: (error as Error).message });
  });
  app.decorate('ctx', {
    repos: {
      papers: {
        findById: vi.fn(() =>
          okAsync({
            id: 'paper-1',
            submitterDid: overrides.submitterDid ?? 'did:web:openxiv.test:u:author',
            uri: null,
          }),
        ),
        loadWithRelations: vi.fn(() =>
          okAsync({
            paper: {
              id: 'paper-1',
              submitterDid: overrides.submitterDid ?? 'did:web:openxiv.test:u:author',
            },
            authors: (overrides.authorDids ?? []).map((did, position) => ({
              paperId: 'paper-1',
              position,
              displayName: `Author ${position + 1}`,
              orcid: null,
              affiliation: null,
              affiliationRor: null,
              did,
              isCorresponding: position === 0,
              creditRoles: [],
            })),
          }),
        ),
      },
      users: {
        findById: vi.fn(() =>
          okAsync({
            id: 'user-1',
            did: userDid,
            blueskyDid: overrides.blueskyDid ?? null,
            legacyDids: overrides.legacyDids ?? [],
          }),
        ),
      },
      endorsements: {
        upsert,
      },
    },
  } as unknown as AppContext);
  app.decorate('requireAuth', async (req: unknown) => {
    (req as { session?: SessionPayload }).session = {
      uid: 'user-1',
      did: sessionDid,
      role: 'author',
      exp: Math.floor(Date.now() / 1000) + 60,
    };
  });
  return { app, upsert };
}

describe('endorsementsRoutes self-endorsement guard', () => {
  it('rejects when a linked Bluesky DID matches the paper submitter DID', async () => {
    const { app, upsert } = appWithEndorsementContext({
      sessionDid: 'did:web:openxiv.test:u:author',
      userDid: 'did:web:openxiv.test:u:author',
      blueskyDid: 'did:plc:author',
      submitterDid: 'did:plc:author',
    });
    await app.register(endorsementsRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/papers/00000000-0000-0000-0000-000000000001/endorsements',
      payload: { verb: 'useful_background' },
    });

    expect(res.statusCode).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects when any paper author DID belongs to the current user', async () => {
    const { app, upsert } = appWithEndorsementContext({
      sessionDid: 'did:web:openxiv.test:u:author',
      blueskyDid: 'did:plc:author',
      authorDids: ['did:plc:author'],
    });
    await app.register(endorsementsRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/papers/00000000-0000-0000-0000-000000000001/endorsements',
      payload: { verb: 'useful_background' },
    });

    expect(res.statusCode).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
    await app.close();
  });
});
