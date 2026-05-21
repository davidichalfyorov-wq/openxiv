import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  paperFigureExtractions,
  paperFigures,
  type PaperFigureExtractionReason,
  type PaperFigureExtractionRecord,
  type PaperFigureExtractionSource,
  type PaperFigureRecord,
  type PaperFigureType,
  type FigureBbox,
} from '../schema/paper-figures.js';
import { paperVersions } from '../schema/papers.js';

export type {
  PaperFigureExtractionReason,
  PaperFigureExtractionRecord,
  PaperFigureExtractionSource,
  PaperFigureRecord,
  PaperFigureType,
  FigureBbox,
} from '../schema/paper-figures.js';

export interface PaperFigureUpsertInput {
  paperId: string;
  version: number;
  idx: number;
  imageUrl: string;
  caption: string | null;
  page: number | null;
  bbox: FigureBbox | null;
  type: PaperFigureType;
}

export interface PaperFigureExtractionCompleteInput {
  paperId: string;
  version: number;
  source: PaperFigureExtractionSource;
  reason: PaperFigureExtractionReason;
  figureCount: number;
}

export interface PaperFiguresRepository {
  /**
   * Replace the entire figure set for a (paper, version). Used by the
   * `pdf-figures` worker on each run. Atomic: opens a tx, deletes the
   * existing rows for this version, inserts the new ones. A failed
   * extract that produces zero rows leaves the table empty for that
   * version (which the UI renders as "no figures detected").
   */
  replaceForVersion(
    paperId: string,
    version: number,
    rows: PaperFigureUpsertInput[],
  ): AppResultAsync<number>;

  /**
   * Durable completion marker for the figure pipeline. This is separate
   * from `paper_figures` rows because a correct extraction may find zero
   * figures, and the UI/backfill scripts still need to know it ran.
   */
  markExtractionComplete(input: PaperFigureExtractionCompleteInput): AppResultAsync<void>;

  /** All figures for a (paper, version), ordered by `idx ASC`. */
  forVersion(paperId: string, version: number): AppResultAsync<PaperFigureRecord[]>;

  /** Completion marker for a (paper, version), or null if the worker has not completed. */
  extractionForVersion(
    paperId: string,
    version: number,
  ): AppResultAsync<PaperFigureExtractionRecord | null>;

  /** All figures for a paper at its most recent version (ordered by idx). */
  forPaperLatest(paperId: string): AppResultAsync<PaperFigureRecord[]>;

  /** Completion marker for the most recent version, or null if the worker has not completed. */
  extractionForPaperLatest(paperId: string): AppResultAsync<PaperFigureExtractionRecord | null>;

  /**
   * Batched lookup: for each paperId, return the URL of figure idx=0 at
   * the most recent version, or omit the entry if there is none. Used
   * by the feed list serializer to render figure thumbnails without a
   * per-paper roundtrip.
   */
  firstFigureForPapers(paperIds: string[]): AppResultAsync<Record<string, string>>;
}

export function makePaperFiguresRepository(db: Database): PaperFiguresRepository {
  return {
    replaceForVersion(paperId, version, rows) {
      return fromPromise(
        db.transaction(async (tx) => {
          await tx
            .delete(paperFigures)
            .where(and(eq(paperFigures.paperId, paperId), eq(paperFigures.version, version)));
          if (rows.length === 0) return 0;
          await tx.insert(paperFigures).values(
            rows.map((r) => ({
              paperId: r.paperId,
              version: r.version,
              idx: r.idx,
              imageUrl: r.imageUrl,
              caption: r.caption,
              page: r.page,
              bbox: r.bbox,
              type: r.type,
            })),
          );
          return rows.length;
        }),
        (cause) => Errors.internal('paper_figures.replaceForVersion', cause),
      );
    },

    markExtractionComplete(input) {
      return fromPromise(
        db
          .insert(paperFigureExtractions)
          .values({
            paperId: input.paperId,
            version: input.version,
            source: input.source,
            reason: input.reason,
            figureCount: input.figureCount,
          })
          .onConflictDoUpdate({
            target: [paperFigureExtractions.paperId, paperFigureExtractions.version],
            set: {
              source: input.source,
              reason: input.reason,
              figureCount: input.figureCount,
              completedAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          })
          .then(() => undefined),
        (cause) => Errors.internal('paper_figures.markExtractionComplete', cause),
      );
    },

    forVersion(paperId, version) {
      return fromPromise(
        db
          .select()
          .from(paperFigures)
          .where(and(eq(paperFigures.paperId, paperId), eq(paperFigures.version, version)))
          .orderBy(asc(paperFigures.idx))
          .then((rows) => rows as PaperFigureRecord[]),
        (cause) => Errors.internal('paper_figures.forVersion', cause),
      );
    },

    extractionForVersion(paperId, version) {
      return fromPromise(
        db
          .select()
          .from(paperFigureExtractions)
          .where(
            and(
              eq(paperFigureExtractions.paperId, paperId),
              eq(paperFigureExtractions.version, version),
            ),
          )
          .limit(1)
          .then((rows) => (rows[0] as PaperFigureExtractionRecord | undefined) ?? null),
        (cause) => Errors.internal('paper_figures.extractionForVersion', cause),
      );
    },

    forPaperLatest(paperId) {
      return fromPromise(
        (async () => {
          const latest = await db
            .select({ version: paperVersions.versionNumber })
            .from(paperVersions)
            .where(eq(paperVersions.paperId, paperId))
            .orderBy(desc(paperVersions.versionNumber))
            .limit(1);
          const version = latest[0]?.version;
          if (version === undefined) return [];
          return db
            .select()
            .from(paperFigures)
            .where(and(eq(paperFigures.paperId, paperId), eq(paperFigures.version, version)))
            .orderBy(asc(paperFigures.idx));
        })(),
        (cause) => Errors.internal('paper_figures.forPaperLatest', cause),
      );
    },

    extractionForPaperLatest(paperId) {
      return fromPromise(
        (async () => {
          const latest = await db
            .select({ version: paperVersions.versionNumber })
            .from(paperVersions)
            .where(eq(paperVersions.paperId, paperId))
            .orderBy(desc(paperVersions.versionNumber))
            .limit(1);
          const version = latest[0]?.version;
          if (version === undefined) return null;
          const rows = await db
            .select()
            .from(paperFigureExtractions)
            .where(
              and(
                eq(paperFigureExtractions.paperId, paperId),
                eq(paperFigureExtractions.version, version),
              ),
            )
            .limit(1);
          return (rows[0] as PaperFigureExtractionRecord | undefined) ?? null;
        })(),
        (cause) => Errors.internal('paper_figures.extractionForPaperLatest', cause),
      );
    },

    firstFigureForPapers(paperIds) {
      if (paperIds.length === 0) {
        return fromPromise(Promise.resolve({}), (cause) =>
          Errors.internal('paper_figures.firstFigureForPapers', cause),
        );
      }
      // The ordering gives us "the row with the smallest idx at the
      // highest version for each paper". We fold it in JS to keep the
      // result in Drizzle's camelCase shape instead of raw snake_case rows.
      return fromPromise(
        db
          .select()
          .from(paperFigures)
          .where(inArray(paperFigures.paperId, paperIds))
          .orderBy(asc(paperFigures.paperId), desc(paperFigures.version), asc(paperFigures.idx))
          .then((rows) => {
            const out: Record<string, string> = {};
            for (const row of rows) {
              if (!out[row.paperId]) out[row.paperId] = row.imageUrl;
            }
            return out;
          }),
        (cause) => Errors.internal('paper_figures.firstFigureForPapers', cause),
      );
    },
  };
}
