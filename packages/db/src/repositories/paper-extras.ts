import { and, desc, eq, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  PAPER_LABEL_VALUES,
  paperArtifacts,
  paperEnrichment,
  paperLabels,
  type OpenAlexRelatedWork,
  type PaperArtifactType,
  type PaperLabelValue,
} from '../schema/paper-extras.js';

export type PaperLabelRecord = typeof paperLabels.$inferSelect;
export type PaperArtifactRecord = typeof paperArtifacts.$inferSelect;
export type PaperEnrichmentRecord = typeof paperEnrichment.$inferSelect;

export interface PaperLabelsRepository {
  apply(input: {
    paperId: string;
    label: PaperLabelValue;
    appliedBy: string;
  }): AppResultAsync<PaperLabelRecord>;
  remove(paperId: string, label: PaperLabelValue): AppResultAsync<void>;
  listForPaper(paperId: string): AppResultAsync<PaperLabelRecord[]>;
}

export function makePaperLabelsRepository(db: Database): PaperLabelsRepository {
  return {
    apply({ paperId, label, appliedBy }) {
      if (!PAPER_LABEL_VALUES.includes(label)) {
        return fromPromise(Promise.reject(new Error('bad label')), () =>
          Errors.validation(`unknown label ${label}`),
        );
      }
      return fromPromise(
        db
          .insert(paperLabels)
          .values({ paperId, label, appliedBy })
          // (paper_id, label) is unique — idempotent re-apply is a no-op
          // that returns the existing row.
          .onConflictDoUpdate({
            target: [paperLabels.paperId, paperLabels.label],
            set: { ts: sql`now()`, appliedBy: sql`excluded.applied_by` },
          })
          .returning(),
        (cause) => Errors.internal('paperLabels.apply', cause),
      ).map((rows) => rows[0]!);
    },
    remove(paperId, label) {
      return fromPromise(
        db
          .delete(paperLabels)
          .where(and(eq(paperLabels.paperId, paperId), eq(paperLabels.label, label))),
        (cause) => Errors.internal('paperLabels.remove', cause),
      ).map(() => undefined);
    },
    listForPaper(paperId) {
      return fromPromise(
        db.select().from(paperLabels).where(eq(paperLabels.paperId, paperId)).orderBy(desc(paperLabels.ts)),
        (cause) => Errors.internal('paperLabels.listForPaper', cause),
      );
    },
  };
}

export interface PaperArtifactsRepository {
  add(input: {
    paperId: string;
    artifactType: PaperArtifactType;
    url: string;
    parsedMetadata?: Record<string, unknown> | null;
  }): AppResultAsync<PaperArtifactRecord>;
  listForPaper(paperId: string): AppResultAsync<PaperArtifactRecord[]>;
  remove(id: string): AppResultAsync<void>;
}

export function makePaperArtifactsRepository(db: Database): PaperArtifactsRepository {
  return {
    add({ paperId, artifactType, url, parsedMetadata }) {
      return fromPromise(
        db
          .insert(paperArtifacts)
          .values({
            paperId,
            artifactType,
            url,
            parsedMetadata: parsedMetadata ?? null,
            fetchedAt: parsedMetadata ? new Date() : null,
          })
          .returning(),
        (cause) => Errors.internal('paperArtifacts.add', cause),
      ).map((rows) => rows[0]!);
    },
    listForPaper(paperId) {
      return fromPromise(
        db
          .select()
          .from(paperArtifacts)
          .where(eq(paperArtifacts.paperId, paperId))
          .orderBy(desc(paperArtifacts.addedAt)),
        (cause) => Errors.internal('paperArtifacts.listForPaper', cause),
      );
    },
    remove(id) {
      return fromPromise(
        db.delete(paperArtifacts).where(eq(paperArtifacts.id, id)),
        (cause) => Errors.internal('paperArtifacts.remove', cause),
      ).map(() => undefined);
    },
  };
}

export interface PaperEnrichmentRepository {
  upsert(input: {
    paperId: string;
    openalexId: string | null;
    relatedWorks: OpenAlexRelatedWork[];
    topics: string[];
    institutions: string[];
  }): AppResultAsync<PaperEnrichmentRecord>;
  get(paperId: string): AppResultAsync<PaperEnrichmentRecord | null>;
}

export function makePaperEnrichmentRepository(db: Database): PaperEnrichmentRepository {
  return {
    upsert(input) {
      return fromPromise(
        db
          .insert(paperEnrichment)
          .values({
            paperId: input.paperId,
            openalexId: input.openalexId,
            relatedWorks: input.relatedWorks,
            topics: input.topics,
            institutions: input.institutions,
            fetchedAt: new Date(),
            source: 'openalex',
          })
          .onConflictDoUpdate({
            target: paperEnrichment.paperId,
            set: {
              openalexId: sql`excluded.openalex_id`,
              relatedWorks: sql`excluded.related_works`,
              topics: sql`excluded.topics`,
              institutions: sql`excluded.institutions`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          })
          .returning(),
        (cause) => Errors.internal('paperEnrichment.upsert', cause),
      ).map((rows) => rows[0]!);
    },
    get(paperId) {
      return fromPromise(
        db
          .select()
          .from(paperEnrichment)
          .where(eq(paperEnrichment.paperId, paperId))
          .limit(1),
        (cause) => Errors.internal('paperEnrichment.get', cause),
      ).map((rows) => rows[0] ?? null);
    },
  };
}
