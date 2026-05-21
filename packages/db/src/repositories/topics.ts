import { sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';

export interface TopicPaperHit {
  paperId: string;
  openxivId: string | null;
  openxivUrlId: string | null;
  title: string;
  abstractFragment: string | null;
  publishedAt: string | null;
  primaryCategory: string;
}

export interface TopicCategoryCount {
  code: string;
  count: number;
}

export interface TopicCategoryMembership {
  paperId: string;
  code: string;
}

export interface TopicsRepository {
  /** Published paper counts per category, including primary and cross-listed categories. */
  categoryCounts(): AppResultAsync<TopicCategoryCount[]>;
  /**
   * Deduplicated `(paper_id, category_code)` rows across primary + cross-
   * listings. Callers can collapse this into per-category, per-group, or
   * grand-total *distinct* paper counts — `categoryCounts` only exposes
   * per-category, which double-counts when summed for a group or for the
   * whole repository because most physics/math papers cross-list.
   */
  categoryMemberships(): AppResultAsync<TopicCategoryMembership[]>;
  /** Published papers whose category list contains `code`. */
  byCategory(code: string, limit: number): AppResultAsync<TopicPaperHit[]>;
  /**
   * Published papers whose keyword list matches `slug` (raw or slugified).
   * Matches both `keyword = slug` and a regex-normalized equivalent so
   * "Machine Learning" stored verbatim still appears under /topics/machine-learning.
   */
  byKeyword(slug: string, limit: number): AppResultAsync<TopicPaperHit[]>;
}

export function makeTopicsRepository(db: Database): TopicsRepository {
  return {
    categoryCounts() {
      return fromPromise(
        db.execute<CategoryCountRow>(sql`
          SELECT code, count(DISTINCT paper_id)::int AS count
          FROM (
            SELECT p.id AS paper_id, p.primary_category AS code
            FROM papers p
            WHERE p.status = 'published'
            UNION ALL
            SELECT p.id AS paper_id, unnest(p.cross_listings) AS code
            FROM papers p
            WHERE p.status = 'published'
          ) category_membership
          WHERE code IS NOT NULL AND code <> ''
          GROUP BY code
          ORDER BY count DESC, code ASC
        `),
        (cause) => Errors.internal('topics.categoryCounts', cause),
      ).map((res) =>
        res.rows.map((row) => ({
          code: String(row.code),
          count: Number(row.count) || 0,
        })),
      );
    },
    categoryMemberships() {
      return fromPromise(
        db.execute<{ paper_id: string; code: string }>(sql`
          SELECT DISTINCT paper_id, code FROM (
            SELECT p.id AS paper_id, p.primary_category AS code
            FROM papers p
            WHERE p.status = 'published' AND p.primary_category IS NOT NULL
            UNION ALL
            SELECT p.id AS paper_id, unnest(p.cross_listings) AS code
            FROM papers p
            WHERE p.status = 'published'
          ) membership
          WHERE code IS NOT NULL AND code <> ''
        `),
        (cause) => Errors.internal('topics.categoryMemberships', cause),
      ).map((res) =>
        res.rows.map((row) => ({
          paperId: String(row.paper_id),
          code: String(row.code),
        })),
      );
    },
    byCategory(code, limit) {
      return fromPromise(
        db.execute<RowShape>(sql`
          SELECT p.id, p.openxiv_id, p.title, p.abstract, p.published_at, p.primary_category
          FROM papers p
          JOIN paper_categories pc ON pc.paper_id = p.id
          WHERE p.status = 'published' AND pc.category_code = ${code}
          ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
          LIMIT ${limit}
        `),
        (cause) => Errors.internal('topics.byCategory', cause),
      ).map((res) => res.rows.map(rowToHit));
    },
    byKeyword(slug, limit) {
      return fromPromise(
        db.execute<RowShape>(sql`
          SELECT DISTINCT p.id, p.openxiv_id, p.title, p.abstract, p.published_at, p.primary_category
          FROM papers p
          JOIN paper_keywords pk ON pk.paper_id = p.id
          WHERE p.status = 'published'
            AND (
              pk.keyword = ${slug}
              OR regexp_replace(lower(pk.keyword), '[^a-z0-9]+', '-', 'g') = ${slug}
            )
          ORDER BY p.published_at DESC NULLS LAST
          LIMIT ${limit}
        `),
        (cause) => Errors.internal('topics.byKeyword', cause),
      ).map((res) => res.rows.map(rowToHit));
    },
  };
}

interface CategoryCountRow extends Record<string, unknown> {
  code: string;
  count: number;
}

interface RowShape extends Record<string, unknown> {
  id: string;
  openxiv_id: string | null;
  title: string;
  abstract: string | null;
  published_at: Date | string | null;
  primary_category: string;
}

function rowToHit(r: RowShape): TopicPaperHit {
  const urlId = r.openxiv_id ? r.openxiv_id.replace(/^openxiv:/, '') : null;
  const publishedAt =
    r.published_at === null
      ? null
      : r.published_at instanceof Date
        ? r.published_at.toISOString()
        : new Date(r.published_at).toISOString();
  return {
    paperId: r.id,
    openxivId: r.openxiv_id,
    openxivUrlId: urlId,
    title: r.title,
    abstractFragment: r.abstract ? r.abstract.slice(0, 240) : null,
    publishedAt,
    primaryCategory: r.primary_category,
  };
}
