import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import { healthRoutes } from './health.js';

describe('metrics route', () => {
  it('exports dependency, queue, and saga metrics in Prometheus text format', async () => {
    const app = Fastify();
    const query = vi.fn(async (sql: string) => {
      if (sql === 'select 1') return { rows: [{ '?column?': 1 }] };
      return {
        rows: [
          {
            stage_paper_persisted: true,
            stage_paper_approved: true,
            stage_id_assigned: false,
            stage_pds_paper: false,
            stage_pds_summary_disclosure: false,
            stage_bluesky_bridge: false,
            last_error_stage: 'stageIdAssigned',
          },
        ],
      };
    });
    app.decorate('ctx', {
      env: { USE_MOCK_CLIENTS: true, USE_MOCK_GROBID: true },
      db: { pool: { query } },
      redis: {
        ping: vi.fn(async () => 'PONG'),
        llen: vi.fn(async () => 2),
      },
      clients: {
        storage: {
          presignGet: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve('https://s3.local/ping'))),
        },
      },
      queues: {
        compile: {
          name: 'openxiv.compile',
          getJobCounts: vi.fn(async () => ({
            waiting: 3,
            active: 1,
            delayed: 0,
            failed: 1,
            completed: 9,
          })),
        },
        close: vi.fn(),
      },
    } as unknown as AppContext);
    app.decorate('requireAuth', async () => {});
    await app.register(healthRoutes);

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('openxiv_dependency_up{dependency="postgres"} 1');
    expect(res.body).toContain('openxiv_dependency_up{dependency="grobid"} 1');
    expect(res.body).toContain(
      'openxiv_queue_jobs{queue="openxiv.compile",logical_queue="compile",state="waiting"} 3',
    );
    expect(res.body).toContain('openxiv_queue_dlq{queue="openxiv.compile",logical_queue="compile"} 2');
    expect(res.body).toContain(
      'openxiv_saga_stage_total{stage="stageIdAssigned",outcome="failed",window="24h"} 1',
    );
    expect(res.body).toContain(
      'openxiv_saga_stage_success_rate{stage="stageIdAssigned",window="24h"} 0',
    );
    expect(res.body).toContain('openxiv_bsky_did_resolution_total{outcome="success"} 0');
    await app.close();
  });
});
