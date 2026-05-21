import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AppError, ResultAsync } from '@openxiv/shared';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppContext } from '../context.js';
import type { SessionPayload } from '../auth/session.js';
import { meSubmissionsRoutes } from './me-submissions.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));

function paper(
  overrides: Partial<{
    id: string;
    openxivId: string | null;
    uri: string | null;
    title: string;
    abstract: string | null;
    primaryCategory: string;
    crossListings: string[];
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    submitterDid: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'paper-1',
    openxivId: overrides.openxivId ?? null,
    uri: overrides.uri ?? null,
    title: overrides.title ?? 'A submitted preprint',
    abstract: overrides.abstract ?? 'Submission abstract.',
    primaryCategory: overrides.primaryCategory ?? 'gr-qc',
    crossListings: overrides.crossListings ?? [],
    status: overrides.status ?? 'pending_review',
    publishedAt: overrides.publishedAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-05-19T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-05-19T01:00:00Z'),
    submitterDid: overrides.submitterDid ?? 'did:plc:linked-author',
  };
}

describe('meSubmissionsRoutes', () => {
  it('returns private submissions across linked identities with moderator feedback', async () => {
    const list = vi.fn(({ submitterDid }: { submitterDid: string }) =>
      okAsync(
        submitterDid === 'did:plc:linked-author'
          ? [paper({ id: 'paper-feedback', title: 'Needs a clearer source bundle' })]
          : [],
      ),
    );
    const getByPaperId = vi.fn((paperId: string) =>
      okAsync(
        paperId === 'paper-feedback'
          ? {
              paperId,
              reasonCategory: 'scope',
              fixable: true,
              examples: [{ section: 'Abstract', problem: 'Too terse', suggestion: 'Add method detail' }],
              moderatorNote: 'Please resubmit with a clearer abstract and complete source files.',
              issuedByDid: 'did:web:openxiv.net:admin',
              issuedAt: new Date('2026-05-19T02:00:00Z'),
              rescindedAt: null,
            }
          : null,
      ),
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
        users: {
          findById: vi.fn(() =>
            okAsync({
              id: 'user-1',
              did: 'did:web:openxiv.net:u:orcid.0000',
              blueskyDid: 'did:plc:linked-author',
              legacyDids: ['did:plc:legacy-author'],
            }),
          ),
        },
        papers: { list },
        refusals: { getByPaperId },
      },
    } as unknown as AppContext);
    app.decorate('requireAuth', async (req: unknown) => {
      (req as { session?: SessionPayload }).session = {
        uid: 'user-1',
        did: 'did:web:openxiv.net:u:orcid.0000',
        role: 'author',
        exp: Math.floor(Date.now() / 1000) + 60,
      };
    });
    await app.register(meSubmissionsRoutes);

    const res = await app.inject({ method: 'GET', url: '/me/submissions' });

    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ submitterDid: 'did:plc:linked-author' }));
    expect(res.json()).toMatchObject({
      items: [
        {
          id: 'paper-feedback',
          status: 'pending_review',
          feedback: {
            fixable: true,
            moderatorNote: 'Please resubmit with a clearer abstract and complete source files.',
            examples: [{ section: 'Abstract', problem: 'Too terse', suggestion: 'Add method detail' }],
          },
        },
      ],
    });
    await app.close();
  });
});
