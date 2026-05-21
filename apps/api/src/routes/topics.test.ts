import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppContext } from '../context.js';
import { topicsRoutes } from './topics.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));

describe('topicsRoutes', () => {
  it('serves grouped category browse data with distinct paper counts', async () => {
    // Per-category counts are the legacy, double-counted shape (paper P1
    // appears in both `gr-qc` and `hep-th` so the sum is inflated).
    const categoryCounts = vi.fn(() =>
      okAsync([
        { code: 'gr-qc', count: 2 },
        { code: 'hep-th', count: 2 },
        { code: 'math-ph', count: 1 },
        { code: 'cs.AI', count: 4 },
      ]),
    );
    // Memberships are the deduped (paper, category) rows the route now
    // uses to derive *distinct* group and grand-total counts. Three
    // physics papers cross-listed across gr-qc/hep-th/math-ph and four
    // distinct ML papers in cs.AI = 7 distinct in total, 3 distinct in
    // the Physics group.
    const categoryMemberships = vi.fn(() =>
      okAsync([
        { paperId: 'p1', code: 'gr-qc' },
        { paperId: 'p1', code: 'hep-th' },
        { paperId: 'p2', code: 'gr-qc' },
        { paperId: 'p2', code: 'math-ph' },
        { paperId: 'p3', code: 'hep-th' },
        { paperId: 'm1', code: 'cs.AI' },
        { paperId: 'm2', code: 'cs.AI' },
        { paperId: 'm3', code: 'cs.AI' },
        { paperId: 'm4', code: 'cs.AI' },
      ]),
    );

    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('ctx', {
      repos: {
        topics: {
          categoryCounts,
          categoryMemberships,
          byCategory: vi.fn(),
          byKeyword: vi.fn(),
        },
      },
    } as unknown as AppContext);
    await app.register(topicsRoutes);

    const res = await app.inject({ method: 'GET', url: '/topics/categories' });

    expect(res.statusCode, res.body).toBe(200);
    expect(categoryCounts).toHaveBeenCalledOnce();
    expect(categoryMemberships).toHaveBeenCalledOnce();
    expect(res.headers['cache-control']).toContain('s-maxage=300');
    const data = res.json();
    // Distinct papers across all categories, NOT the sum of per-category
    // counts (which would be 9 here because of cross-listings).
    expect(data.totalPublished).toBe(7);
    expect(data.popular[0]).toMatchObject({ code: 'cs.AI', paperCount: 4 });
    expect(data.groups[0]).toMatchObject({
      group: 'Physics',
      // Distinct: p1, p2, p3 — three papers, not 5 (= 2+2+1 sum).
      paperCount: 3,
      categories: expect.arrayContaining([
        expect.objectContaining({ code: 'gr-qc', paperCount: 2, href: '/topics/gr-qc' }),
        expect.objectContaining({ code: 'hep-th', paperCount: 2, href: '/topics/hep-th' }),
        expect.objectContaining({ code: 'math-ph', paperCount: 1, href: '/topics/math-ph' }),
      ]),
    });
    await app.close();
  });
});
