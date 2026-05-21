import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AppError, ResultAsync } from '@openxiv/shared';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppContext } from '../context.js';
import type { SessionPayload } from '../auth/session.js';
import type { Services } from '../services/index.js';
import { papersRoutes } from './papers.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));

describe('papersRoutes admin HTML recompile', () => {
  it('requires admin auth and enqueues a dedicated HTML compile job', async () => {
    const paperId = '8f4e530e-1a6b-4912-8ce7-445a34f74404';
    const recompileHtml = vi.fn(() => okAsync({ queued: true as const, jobId: 'html-paper-1-v1' }));
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
      env: {
        ADMIN_DIDS: ['did:plc:admin'],
        PUBLIC_WEB_BASE: 'https://openxiv.net',
        FEED_GENERATOR_DID: 'did:web:openxiv.net',
      },
      repos: {
        papers: {
          findById: vi.fn(() => okAsync({ id: paperId, submitterDid: 'did:plc:author' })),
          findByOpenxivId: vi.fn(),
        },
      },
      clients: {},
    } as unknown as AppContext);
    app.decorate('services', {
      users: { isAdminDid: (did: string) => did === 'did:plc:admin' },
      submissions: { recompileHtml },
    } as unknown as Services);
    app.decorate('requireAuth', async (req: unknown) => {
      (req as { session?: SessionPayload }).session = {
        uid: 'admin-user',
        did: 'did:plc:admin',
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 60,
      };
    });
    await app.register(papersRoutes);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/papers/${paperId}/recompile-html`,
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, queued: true, jobId: 'html-paper-1-v1' });
    expect(recompileHtml).toHaveBeenCalledWith(paperId, {
      requestedByDid: 'did:plc:admin',
    });
    await app.close();
  });
});
