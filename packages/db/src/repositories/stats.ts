import { sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';

export interface DisclosureOverviewRow {
  papersTotal: number;
  papersWithDisclosure: number;
  papersWithoutDisclosure: number;
  levelNone: number;
  levelAssistant: number;
  levelCoauthor: number;
  levelPrimary: number;
  summariesAiGenerated: number;
}

export interface CategoryRow {
  category: string;
  papersTotal: number;
  levelNone: number;
  levelAssistant: number;
  levelCoauthor: number;
  levelPrimary: number;
}

export interface AiUseRow {
  aiUse: string;
  papers: number;
}

export interface ModelRow {
  modelName: string;
  modelVendor: string | null;
  papers: number;
}

export interface WeeklyRow {
  week: string; // ISO date
  papersTotal: number;
  levelNone: number;
  levelAssistant: number;
  levelCoauthor: number;
  levelPrimary: number;
}

export interface DetectorFlagsRow {
  flaggedAboveThreshold: number;
  totalScored: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
}

export interface AntiVanityRow {
  /** Total published papers. */
  papersPublished: number;
  /** Papers that have at least one paper_versions row beyond v1. */
  papersWithRevisions: number;
  /** Avg version count per paper (publication is v1, so floor is 1.0). */
  avgVersionsPerPaper: number;
  /** Posts labeled 'resolved_by_v2' — concrete "the next version answered this". */
  questionsResolvedByV2: number;
  /** Posts labeled 'best_unresolved' — open questions actively elevated. */
  bestUnresolved: number;
  /** Counts of typed endorsements by verb across the whole corpus. */
  endorsementsByVerb: Record<string, number>;
}

export interface StatsRepository {
  overview(): AppResultAsync<DisclosureOverviewRow>;
  byCategory(): AppResultAsync<CategoryRow[]>;
  byAiUse(): AppResultAsync<AiUseRow[]>;
  byModel(): AppResultAsync<ModelRow[]>;
  weekly(): AppResultAsync<WeeklyRow[]>;
  detectorFlags(): AppResultAsync<DetectorFlagsRow>;
  antiVanity(): AppResultAsync<AntiVanityRow>;
  refresh(): AppResultAsync<void>;
}

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number.parseFloat(v) || 0;
  return 0;
};

export function makeStatsRepository(db: Database): StatsRepository {
  return {
    overview() {
      return fromPromise(
        db.execute(sql`SELECT * FROM stats_disclosure_overview`),
        (cause) => Errors.internal('stats.overview', cause),
      ).map((res) => {
        const row = (res.rows as Record<string, unknown>[])[0] ?? {};
        return {
          papersTotal: num(row['papers_total']),
          papersWithDisclosure: num(row['papers_with_disclosure']),
          papersWithoutDisclosure: num(row['papers_without_disclosure']),
          levelNone: num(row['level_none']),
          levelAssistant: num(row['level_assistant']),
          levelCoauthor: num(row['level_coauthor']),
          levelPrimary: num(row['level_primary']),
          summariesAiGenerated: num(row['summaries_ai_generated']),
        };
      });
    },
    byCategory() {
      return fromPromise(
        db.execute(sql`SELECT * FROM stats_disclosure_by_category`),
        (cause) => Errors.internal('stats.byCategory', cause),
      ).map((res) =>
        (res.rows as Record<string, unknown>[]).map((r) => ({
          category: String(r['category'] ?? ''),
          papersTotal: num(r['papers_total']),
          levelNone: num(r['level_none']),
          levelAssistant: num(r['level_assistant']),
          levelCoauthor: num(r['level_coauthor']),
          levelPrimary: num(r['level_primary']),
        })),
      );
    },
    byAiUse() {
      return fromPromise(
        db.execute(sql`SELECT * FROM stats_disclosure_ai_used`),
        (cause) => Errors.internal('stats.byAiUse', cause),
      ).map((res) =>
        (res.rows as Record<string, unknown>[]).map((r) => ({
          aiUse: String(r['ai_use'] ?? ''),
          papers: num(r['papers']),
        })),
      );
    },
    byModel() {
      return fromPromise(
        db.execute(sql`SELECT * FROM stats_disclosure_models`),
        (cause) => Errors.internal('stats.byModel', cause),
      ).map((res) =>
        (res.rows as Record<string, unknown>[]).map((r) => ({
          modelName: String(r['model_name'] ?? ''),
          modelVendor: r['model_vendor'] ? String(r['model_vendor']) : null,
          papers: num(r['papers']),
        })),
      );
    },
    weekly() {
      return fromPromise(
        db.execute(sql`SELECT week, papers_total, level_none, level_assistant, level_coauthor, level_primary FROM stats_disclosure_weekly`),
        (cause) => Errors.internal('stats.weekly', cause),
      ).map((res) =>
        (res.rows as Record<string, unknown>[]).map((r) => ({
          week: r['week'] instanceof Date ? (r['week'] as Date).toISOString() : String(r['week'] ?? ''),
          papersTotal: num(r['papers_total']),
          levelNone: num(r['level_none']),
          levelAssistant: num(r['level_assistant']),
          levelCoauthor: num(r['level_coauthor']),
          levelPrimary: num(r['level_primary']),
        })),
      );
    },
    detectorFlags() {
      return fromPromise(
        db.execute(sql`SELECT * FROM stats_detector_flags`),
        (cause) => Errors.internal('stats.detectorFlags', cause),
      ).map((res) => {
        const r = (res.rows as Record<string, unknown>[])[0] ?? {};
        return {
          flaggedAboveThreshold: num(r['flagged_above_threshold']),
          totalScored: num(r['total_scored']),
          avgScore: num(r['avg_score']),
          minScore: num(r['min_score']),
          maxScore: num(r['max_score']),
        };
      });
    },
    antiVanity() {
      // Six small aggregations in one async — we run them in parallel and
      // fold into a single row. Each individual failure degrades to zeros
      // rather than failing the whole panel.
      const work = async (): Promise<AntiVanityRow> => {
        async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
          try {
            return await p;
          } catch {
            return fallback;
          }
        }
        type Row<T> = { rows: T[] };
        const published = await safe(
          db.execute<{ n: number }>(
            sql`SELECT COUNT(*)::int AS n FROM papers WHERE status = 'published'`,
          ) as Promise<Row<{ n: number }>>,
          { rows: [{ n: 0 }] },
        );
        const withRevs = await safe(
          db.execute<{ n: number }>(
            sql`SELECT COUNT(DISTINCT paper_id)::int AS n
                FROM paper_versions
                WHERE version_number > 1`,
          ) as Promise<Row<{ n: number }>>,
          { rows: [{ n: 0 }] },
        );
        const avgVers = await safe(
          db.execute<{ avg: string | number }>(
            sql`SELECT COALESCE(AVG(c)::numeric(10,2), 0) AS avg FROM (
                  SELECT COUNT(*)::int AS c
                  FROM paper_versions
                  GROUP BY paper_id
                ) sub`,
          ) as Promise<Row<{ avg: string | number }>>,
          { rows: [{ avg: 0 }] },
        );
        const resolved = await safe(
          db.execute<{ n: number }>(
            sql`SELECT COUNT(*)::int AS n FROM posts WHERE label = 'resolved_by_v2'`,
          ) as Promise<Row<{ n: number }>>,
          { rows: [{ n: 0 }] },
        );
        const bestUnres = await safe(
          db.execute<{ n: number }>(
            sql`SELECT COUNT(*)::int AS n FROM posts WHERE label = 'best_unresolved'`,
          ) as Promise<Row<{ n: number }>>,
          { rows: [{ n: 0 }] },
        );
        const verbAgg = await safe(
          db.execute<{ verb: string | null; n: number }>(
            sql`SELECT verb, COUNT(*)::int AS n FROM endorsements WHERE verb IS NOT NULL GROUP BY verb`,
          ) as Promise<Row<{ verb: string | null; n: number }>>,
          { rows: [] },
        );
        const verbs: Record<string, number> = {};
        for (const r of verbAgg.rows) {
          if (r.verb) verbs[r.verb] = r.n;
        }
        return {
          papersPublished: published.rows[0]?.n ?? 0,
          papersWithRevisions: withRevs.rows[0]?.n ?? 0,
          avgVersionsPerPaper: num(avgVers.rows[0]?.avg),
          questionsResolvedByV2: resolved.rows[0]?.n ?? 0,
          bestUnresolved: bestUnres.rows[0]?.n ?? 0,
          endorsementsByVerb: verbs,
        };
      };
      return fromPromise(work(), (cause) => Errors.internal('stats.antiVanity', cause));
    },
    refresh() {
      return fromPromise(
        db.execute(sql`SELECT refresh_stats()`),
        (cause) => Errors.internal('stats.refresh', cause),
      ).map(() => undefined);
    },
  };
}
