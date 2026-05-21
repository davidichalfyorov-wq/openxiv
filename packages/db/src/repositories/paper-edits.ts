import { desc, eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  paperEdits,
  EDITABLE_PAPER_FIELDS,
  type EditablePaperField,
} from '../schema/paper-edits.js';

export type PaperEditRecord = typeof paperEdits.$inferSelect;
export type NewPaperEdit = typeof paperEdits.$inferInsert;

export interface PaperEditsRepository {
  /** Append one audit row. Returns the persisted record. */
  append(input: {
    paperId: string;
    editorDid: string;
    field: EditablePaperField;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }): AppResultAsync<PaperEditRecord>;
  /** Edit history for a paper, newest first. Used by the diff view. */
  listForPaper(paperId: string, limit?: number): AppResultAsync<PaperEditRecord[]>;
  /** Cheap count for the Provenance Timeline. */
  countForPaper(paperId: string): AppResultAsync<number>;
}

export function makePaperEditsRepository(db: Database): PaperEditsRepository {
  return {
    append(input) {
      // The text CHECK on `field` enforces this at the DB layer too; we
      // re-validate here so we can fail fast with a typed error instead
      // of a raw constraint violation.
      if (!EDITABLE_PAPER_FIELDS.includes(input.field)) {
        return fromPromise(Promise.reject(new Error('field not editable')), () =>
          Errors.validation(`field ${input.field} is not editable`),
        );
      }
      return fromPromise(
        db
          .insert(paperEdits)
          .values({
            paperId: input.paperId,
            editorDid: input.editorDid,
            field: input.field,
            oldValue: input.oldValue as never,
            newValue: input.newValue as never,
            reason: input.reason,
          })
          .returning(),
        (cause) => Errors.internal('paperEdits.append', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(Promise.reject(new Error('no row')), (c) =>
              Errors.internal('paperEdits.append empty', c),
            );
      });
    },
    listForPaper(paperId, limit = 50) {
      return fromPromise(
        db
          .select()
          .from(paperEdits)
          .where(eq(paperEdits.paperId, paperId))
          .orderBy(desc(paperEdits.editedAt))
          .limit(limit),
        (cause) => Errors.internal('paperEdits.listForPaper', cause),
      );
    },
    countForPaper(paperId) {
      return fromPromise(
        db
          .select({ paperId: paperEdits.paperId })
          .from(paperEdits)
          .where(eq(paperEdits.paperId, paperId)),
        (cause) => Errors.internal('paperEdits.countForPaper', cause),
      ).map((rows) => rows.length);
    },
  };
}
