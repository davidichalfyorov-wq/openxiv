import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import nock from 'nock';
import {
  createDb,
  makeEndorsementsRepository,
  makePapersRepository,
  type DbHandle,
} from '@openxiv/db';
import type { AppContext } from '../../src/context.js';
import { getEngagement, invalidateEngagementCache } from '../../src/services/engagement-stats.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const TEST_DOI = '10.1145/3368089.3409756';
const TEST_DOI_PATH = '/works/10.1145%2F3368089.3409756';
const CROSSREF_CAPTURED_WORKS_RESPONSE = {
  status: 'ok',
  messageType: 'work',
  messageVersion: '1.0.0',
  message: {
    DOI: TEST_DOI,
    'is-referenced-by-count': 4242,
  },
};

async function databaseReachable(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  const db = createDb(DATABASE_URL, { max: 1, connectionTimeoutMs: 800 });
  try {
    await db.pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await db.close().catch(() => undefined);
  }
}

describe.skipIf(process.env['CI_SKIP_INTEGRATION'] === '1')('engagement stats integration', () => {
  let available = false;
  let db: DbHandle | null = null;
  let redis: RedisMock | null = null;
  let ctx: AppContext | null = null;
  let paperId = '';
  let targetUri = '';
  let openxivId = '';

  beforeAll(async () => {
    nock.disableNetConnect();
    available = await databaseReachable();
    if (!available) return;

    db = createDb(DATABASE_URL);
    redis = new RedisMock();
    ctx = {
      db,
      redis,
      repos: {
        papers: makePapersRepository(db.db),
        endorsements: makeEndorsementsRepository(db.db),
      },
    } as unknown as AppContext;

    const nonce = Math.random().toString(36).slice(2, 10);
    openxivId = `openxiv:physics.2026.${nonce}`;
    targetUri = `at://did:plc:engagement/app.openxiv.paper/${nonce}`;
    const paper = await db.pool.query<{ id: string }>(
      `INSERT INTO papers
        (openxiv_id, uri, submitter_did, title, abstract, license, primary_category, doi, status, published_at)
       VALUES
        ($1, $2, 'did:plc:submitter', 'Engagement integration fixture',
         'Fixture abstract for engagement stats.', 'CC-BY-4.0', 'physics',
         $3, 'published', now())
       RETURNING id`,
      [openxivId, targetUri, TEST_DOI],
    );
    paperId = paper.rows[0]?.id ?? '';

    await db.pool.query(
      `INSERT INTO endorsements (uri, paper_id, endorser_did, verb, note)
       VALUES
        ($1, $2::uuid, 'did:plc:alice', 'verified_derivation', 'checked'),
        ($3, $2::uuid, 'did:plc:bob', 'reproduced_result', null),
        ($4, $2::uuid, 'did:plc:carol', 'verified_derivation', null)`,
      [`at://did:plc:alice/endorse/${paperId}`, paperId, `at://did:plc:bob/endorse/${paperId}`, `at://did:plc:carol/endorse/${paperId}`],
    );

    await db.pool.query(
      `INSERT INTO feed_events (session_id, event_type, target_uri, target_type, context_json)
       VALUES
        ('sess-engagement-a', 'paper_view', $1, 'openxiv_paper', '{}'::jsonb),
        ('sess-engagement-b', 'paper_view', $1, 'openxiv_paper', '{}'::jsonb),
        ('sess-engagement-c', 'html_open', $1, 'openxiv_paper', '{}'::jsonb),
        ('sess-engagement-d', 'pdf_download', $1, 'openxiv_paper', '{}'::jsonb),
        ('sess-engagement-e', 'pdf_download', $1, 'openxiv_paper', '{}'::jsonb)`,
      [targetUri],
    );
  });

  beforeEach(async () => {
    await redis?.flushall();
    nock.cleanAll();
  });

  afterAll(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    if (db && paperId) {
      await db.pool.query('DELETE FROM feed_events WHERE target_uri = $1', [targetUri]).catch(() => undefined);
      await db.pool.query('DELETE FROM papers WHERE id = $1::uuid', [paperId]).catch(() => undefined);
    }
    await redis?.quit().catch(() => undefined);
    await db?.close().catch(() => undefined);
  });

  it('returns endorsement breakdown, read counters, and Crossref citations', async () => {
    if (!available || !ctx) return;

    const crossref = nock('https://api.crossref.org')
      .get(TEST_DOI_PATH)
      .reply(200, CROSSREF_CAPTURED_WORKS_RESPONSE);

    const engagement = await getEngagement(ctx, paperId, { bypassEngagementCache: true });

    expect(engagement.endorsements).toEqual({
      count: 3,
      breakdown: {
        reproduced_result: 1,
        verified_derivation: 2,
      },
    });
    expect(engagement.reads).toEqual({
      views: 2,
      html_opens: 1,
      pdf_downloads: 2,
    });
    expect(engagement.citations).toBe(4242);
    expect(crossref.isDone()).toBe(true);
  });

  it('returns null citations when Crossref fails and caches that fallback', async () => {
    if (!available || !ctx) return;

    const crossref = nock('https://api.crossref.org')
      .get(TEST_DOI_PATH)
      .replyWithError('Crossref timeout');

    const first = await getEngagement(ctx, paperId, { bypassEngagementCache: true });
    expect(first.citations).toBeNull();
    expect(crossref.isDone()).toBe(true);

    const second = await getEngagement(ctx, paperId, { bypassEngagementCache: true });
    expect(second.citations).toBeNull();
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('makes endorsement changes visible immediately after engagement cache invalidation', async () => {
    if (!available || !ctx || !db) return;

    nock('https://api.crossref.org')
      .get(TEST_DOI_PATH)
      .reply(200, CROSSREF_CAPTURED_WORKS_RESPONSE);

    const before = await getEngagement(ctx, paperId);
    expect(before.endorsements.count).toBe(3);

    const did = `did:plc:temp-${Math.random().toString(36).slice(2, 8)}`;
    await db.pool.query(
      `INSERT INTO endorsements (uri, paper_id, endorser_did, verb, note)
       VALUES ($1, $2::uuid, $3, 'useful_background', null)`,
      [`at://${did}/endorse/cache-invalidate`, paperId, did],
    );
    try {
      const cached = await getEngagement(ctx, paperId);
      expect(cached.endorsements.count).toBe(3);

      await invalidateEngagementCache(ctx, paperId);
      const fresh = await getEngagement(ctx, paperId);
      expect(fresh.endorsements.count).toBe(4);
      expect(fresh.endorsements.breakdown.useful_background).toBe(1);
    } finally {
      await db.pool.query('DELETE FROM endorsements WHERE paper_id = $1::uuid AND endorser_did = $2', [
        paperId,
        did,
      ]);
    }
  });
});
