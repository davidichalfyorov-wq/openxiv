import { sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';

export interface BriefSnapshot {
  date: string; // YYYY-MM-DD
  itemsJson: unknown;
  snapshotAt: Date;
}

export interface DailyBriefsRepository {
  /** Load a snapshot by date. */
  get(date: string): AppResultAsync<BriefSnapshot | null>;
  /** Upsert today's snapshot. */
  upsert(date: string, items: unknown): AppResultAsync<void>;
  /**
   * Random recently-published paper for the serendipity slot. Returns null
   * if no published papers exist.
   */
  randomPublishedPaper(): AppResultAsync<{
    id: string;
    openxivId: string | null;
    title: string;
    abstract: string | null;
  } | null>;
  /** Most-recently-claimed external paper (for the claim slot). */
  latestClaimedExternal(): AppResultAsync<{
    source: string;
    sourceId: string;
    title: string;
    claimedByDid: string;
    claimedAt: Date;
  } | null>;
  /** A post labeled best_unresolved (for the open_question slot). */
  latestBestUnresolved(): AppResultAsync<{
    id: string;
    text: string;
    embedPaperUri: string | null;
  } | null>;
  /** A school-tier summary on a published paper (for the explainer slot). */
  latestSchoolExplainer(): AppResultAsync<{
    paperId: string;
    openxivId: string | null;
    title: string;
    text: string;
  } | null>;
}

export function makeDailyBriefsRepository(db: Database): DailyBriefsRepository {
  return {
    get(date) {
      return fromPromise(
        db.execute<{ date: string; items_json: unknown; snapshot_at: Date }>(
          sql`SELECT date, items_json, snapshot_at FROM daily_briefs WHERE date = ${date}::date LIMIT 1`,
        ),
        (cause) => Errors.internal('dailyBriefs.get', cause),
      ).map((res) => {
        const r = res.rows[0];
        if (!r) return null;
        return {
          date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
          itemsJson: r.items_json,
          snapshotAt: r.snapshot_at instanceof Date ? r.snapshot_at : new Date(r.snapshot_at),
        };
      });
    },
    upsert(date, items) {
      return fromPromise(
        db.execute(
          sql`INSERT INTO daily_briefs(date, items_json, snapshot_at)
              VALUES (${date}::date, ${sql.raw(`'${JSON.stringify(items).replace(/'/g, "''")}'`)}::jsonb, now())
              ON CONFLICT (date) DO UPDATE SET items_json = EXCLUDED.items_json, snapshot_at = now()`,
        ),
        (cause) => Errors.internal('dailyBriefs.upsert', cause),
      ).map(() => undefined);
    },
    randomPublishedPaper() {
      return fromPromise(
        db.execute<{ id: string; openxiv_id: string | null; title: string; abstract: string | null }>(
          sql`SELECT id, openxiv_id, title, abstract FROM papers
              WHERE status = 'published' ORDER BY random() LIMIT 1`,
        ),
        (cause) => Errors.internal('dailyBriefs.randomPublishedPaper', cause),
      ).map((res) => {
        const r = res.rows[0];
        if (!r) return null;
        return {
          id: r.id,
          openxivId: r.openxiv_id,
          title: r.title,
          abstract: r.abstract,
        };
      });
    },
    latestClaimedExternal() {
      return fromPromise(
        db.execute<{
          source: string;
          source_id: string;
          title: string;
          claimed_by_did: string;
          claimed_at: Date;
        }>(
          sql`SELECT source, source_id, title, claimed_by_did, claimed_at
              FROM external_papers
              WHERE claimed_by_did IS NOT NULL
              ORDER BY claimed_at DESC NULLS LAST LIMIT 1`,
        ),
        (cause) => Errors.internal('dailyBriefs.latestClaimedExternal', cause),
      ).map((res) => {
        const r = res.rows[0];
        if (!r) return null;
        return {
          source: r.source,
          sourceId: r.source_id,
          title: r.title,
          claimedByDid: r.claimed_by_did,
          claimedAt: r.claimed_at instanceof Date ? r.claimed_at : new Date(r.claimed_at),
        };
      });
    },
    latestBestUnresolved() {
      return fromPromise(
        db.execute<{ id: string; text: string; embed_paper_uri: string | null }>(
          sql`SELECT id, text, embed_paper_uri FROM posts
              WHERE label = 'best_unresolved' AND hidden_by_mod = false
              ORDER BY created_at DESC LIMIT 1`,
        ),
        (cause) => Errors.internal('dailyBriefs.latestBestUnresolved', cause),
      ).map((res) => {
        const r = res.rows[0];
        if (!r) return null;
        return { id: r.id, text: r.text, embedPaperUri: r.embed_paper_uri };
      });
    },
    latestSchoolExplainer() {
      return fromPromise(
        db.execute<{ paper_id: string; openxiv_id: string | null; title: string; text: string }>(
          sql`SELECT s.paper_id, p.openxiv_id, p.title, s.text
              FROM summaries s JOIN papers p ON p.id = s.paper_id
              WHERE s.tier = 'school' AND p.status = 'published'
              ORDER BY s.created_at DESC LIMIT 1`,
        ),
        (cause) => Errors.internal('dailyBriefs.latestSchoolExplainer', cause),
      ).map((res) => {
        const r = res.rows[0];
        if (!r) return null;
        return {
          paperId: r.paper_id,
          openxivId: r.openxiv_id,
          title: r.title,
          text: r.text,
        };
      });
    },
  };
}
