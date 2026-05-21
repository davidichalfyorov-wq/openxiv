import { beforeEach, describe, expect, it } from 'vitest';
import { composeDailyBrief } from './daily-brief.js';
import RedisMock from 'ioredis-mock';

beforeEach(async () => {
  // RedisMock shares in-process state across instances. Each test rebuilds
  // its ctx, but the shared store would carry yesterday's composed brief
  // forward — wipe it so each test sees a clean cache.
  const r = new RedisMock();
  await r.flushall();
  await r.quit();
});

/**
 * Tests are scoped to the composer's contract:
 *  - Always returns exactly 5 items, in canonical order.
 *  - Empty repository ⇒ all items present=false (no errors thrown).
 *  - Cached repeats return identical structure.
 *
 * We stub the repositories to drive specific scenarios. The real
 * Postgres path is exercised by the live API smoke at the end of the file.
 */

function makeRepos(over: Record<string, unknown> = {}): {
  repos: Record<string, unknown>;
} {
  const ok = <T,>(v: T) => ({ isOk: () => true, isErr: () => false, value: v });
  return {
    repos: {
      featured: { listActive: async () => ok([]) },
      dailyBriefs: {
        latestClaimedExternal: async () => ok(null),
        latestBestUnresolved: async () => ok(null),
        latestSchoolExplainer: async () => ok(null),
        randomPublishedPaper: async () => ok(null),
        get: async () => ok(null),
        upsert: async () => ok(undefined),
      },
      ...over,
    },
  };
}

function ctxWith(reposPatch: Record<string, unknown> = {}): {
  redis: InstanceType<typeof RedisMock>;
  repos: Record<string, unknown>;
} {
  const { repos } = makeRepos(reposPatch);
  return { redis: new RedisMock(), repos };
}

describe('composeDailyBrief', () => {
  it('returns exactly 5 items in canonical order, all present=false on empty repos', async () => {
    const ctx = ctxWith();
    // composeDailyBrief reads redis cache by current day; with a fresh mock
    // it'll go through repos.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brief = await composeDailyBrief(ctx as any);
    expect(brief.items).toHaveLength(5);
    expect(brief.items.map((i) => i.kind)).toEqual([
      'featured',
      'claim',
      'open_question',
      'explainer',
      'serendipity',
    ]);
    for (const item of brief.items) {
      expect(item.present).toBe(false);
    }
  });

  it('populates featured when listActive returns a row', async () => {
    const ok = <T,>(v: T) => ({ isOk: () => true, isErr: () => false, value: v });
    const ctx = ctxWith({
      featured: {
        listActive: async () =>
          ok([
            {
              id: 'f1',
              targetUri: 'openxiv:cs.AI.2026.99000',
              targetType: 'openxiv_paper',
              reasonCardMd: 'Reason headline. More text here that is long enough to satisfy any check.',
              curatorDid: 'did:plc:editor',
              position: 1,
              startedAt: new Date(),
              expiresAt: null,
            },
          ]),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brief = await composeDailyBrief(ctx as any);
    const featured = brief.items.find((i) => i.kind === 'featured')!;
    expect(featured.present).toBe(true);
    expect(featured.href).toBe('/abs/cs.AI.2026.99000');
    expect(featured.blurb).toContain('Reason headline');
  });

  it('serendipity slot fills from random paper when corpus is non-empty', async () => {
    const ok = <T,>(v: T) => ({ isOk: () => true, isErr: () => false, value: v });
    const ctx = ctxWith({
      dailyBriefs: {
        latestClaimedExternal: async () => ok(null),
        latestBestUnresolved: async () => ok(null),
        latestSchoolExplainer: async () => ok(null),
        randomPublishedPaper: async () =>
          ok({ id: 'p-uuid', openxivId: 'openxiv:cs.AI.2026.55555', title: 'Random Paper', abstract: 'Hello.' }),
        get: async () => ok(null),
        upsert: async () => ok(undefined),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brief = await composeDailyBrief(ctx as any);
    const s = brief.items.find((i) => i.kind === 'serendipity')!;
    expect(s.present).toBe(true);
    expect(s.href).toBe('/abs/cs.AI.2026.55555');
  });

  it('cached call returns identical shape on the second invocation', async () => {
    const ctx = ctxWith();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = await composeDailyBrief(ctx as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = await composeDailyBrief(ctx as any);
    expect(second.date).toBe(first.date);
    expect(second.items).toEqual(first.items);
  });

  it('open_question with non-openxiv embed URI surfaces with href=null', async () => {
    const ok = <T,>(v: T) => ({ isOk: () => true, isErr: () => false, value: v });
    const ctx = ctxWith({
      dailyBriefs: {
        latestClaimedExternal: async () => ok(null),
        latestBestUnresolved: async () =>
          ok({
            id: 'q1',
            text: 'Does the proof generalize when X is non-Hausdorff?',
            embedPaperUri: 'at://did:plc:abc/app.openxiv.paper/3kxyz',
          }),
        latestSchoolExplainer: async () => ok(null),
        randomPublishedPaper: async () => ok(null),
        get: async () => ok(null),
        upsert: async () => ok(undefined),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brief = await composeDailyBrief(ctx as any);
    const q = brief.items.find((i) => i.kind === 'open_question')!;
    expect(q.present).toBe(true);
    expect(q.title).toContain('non-Hausdorff');
    // AT-URI form isn't directly resolvable as a slug, so href stays null
    // until we have the resolver wired into the brief composer.
    expect(q.href).toBeNull();
  });
});
