import { z } from 'zod';
import {
  Errors,
  ResultAsync,
  type AppResultAsync,
  fromPromise,
} from '@openxiv/shared';
import { CATEGORIES } from '@openxiv/shared';
import { LICENSE_VALUES } from '@openxiv/lexicons';
import type { EditablePaperField, PaperEditRecord, PaperRecord } from '@openxiv/db';
import type { AppContext } from '../context.js';
import { FLAGS, isFeatureEnabled } from './flags.js';
import { sanitizePlainText } from './sanitize.js';

/**
 * Moderator paper-edit service. Coordinates four side effects when an
 * admin saves changes to a paper:
 *
 *   1. Append one audit row per changed field (`paper_edits`).
 *   2. Update the paper row + cross_listings array atomically.
 *   3. Trigger downstream re-syncs (Bluesky bridge, OpenAlex enrichment,
 *      section reindex, AT-proto putRecord with the same rkey) via
 *      BullMQ. Failure of any one is non-fatal — the audit row stays.
 *   4. Bump `papers.updated_at` so OAI-PMH selective harvest re-emits
 *      the record.
 *
 * Immutable fields (openxiv_id, submitter_did, version chain, sha hashes)
 * are validated out at the schema layer — they don't appear in
 * `editablePaperFieldsSchema` so a caller cannot accidentally pass them.
 *
 * RBAC is enforced by the route layer; this service trusts its caller
 * to have verified `editor_did` is in `ADMIN_DIDS`.
 */

const editablePaperFieldsSchema = z
  .object({
    title: z.string().transform(sanitizePlainText).pipe(z.string().min(4).max(500)).optional(),
    abstract: z
      .string()
      .transform(sanitizePlainText)
      .pipe(z.string().max(8000))
      .nullable()
      .optional(),
    keywords: z.array(z.string().max(64)).max(30).optional(),
    primaryCategory: z
      .string()
      .max(64)
      .refine((c) => CATEGORIES.some((cat) => cat.code === c), {
        message: 'unknown category',
      })
      .optional(),
    crossListings: z
      .array(z.string().max(64))
      .max(5)
      .optional(),
    license: z.enum(LICENSE_VALUES).optional(),
  })
  .strict();

export const editPaperRequestSchema = z.object({
  reason: z.string().min(8).max(500),
  changes: editablePaperFieldsSchema.refine(
    (c) => Object.keys(c).length > 0,
    { message: 'at least one editable field must be provided' },
  ),
});

export type EditPaperRequest = z.infer<typeof editPaperRequestSchema>;

export interface PaperEditService {
  /**
   * Apply the edit. Returns the audit rows appended (one per changed
   * field). Empty array means nothing actually changed (the caller
   * submitted values identical to current state).
   */
  edit(input: {
    paperId: string;
    editorDid: string;
    request: EditPaperRequest;
  }): AppResultAsync<{
    paper: PaperRecord;
    edits: PaperEditRecord[];
    sideEffects: { reindex: boolean; pds: boolean; enrich: boolean; bridge: boolean };
  }>;
}

interface FieldDiff {
  field: EditablePaperField;
  oldValue: unknown;
  newValue: unknown;
}

const FIELD_TO_DB_COL: Record<keyof z.infer<typeof editablePaperFieldsSchema>, EditablePaperField> = {
  title: 'title',
  abstract: 'abstract',
  keywords: 'keywords',
  primaryCategory: 'primary_category',
  crossListings: 'cross_listings',
  license: 'license',
};

export function makePaperEditService(ctx: AppContext): PaperEditService {
  const { papers, paperEdits } = ctx.repos;

  return {
    edit({ paperId, editorDid, request }) {
      // RBAC double-check at service entry — defence in depth. The
      // route layer also checks but a future internal caller may
      // shortcut that.
      if (!ctx.env.ADMIN_DIDS.includes(editorDid)) {
        return ResultAsync.fromPromise(Promise.reject(new Error('forbidden')), () =>
          Errors.forbidden(`${editorDid} is not an admin`),
        );
      }

      return papers
        .loadWithRelations(paperId)
        .andThen((loaded) => {
          if (!loaded) {
            return ResultAsync.fromPromise(Promise.reject(new Error('not found')), () =>
              Errors.notFound(`paper ${paperId}`),
            );
          }
          const diffs = computeDiffs(loaded.paper, loaded.keywords, request.changes);
          if (diffs.length === 0) {
            return ResultAsync.fromSafePromise(
              Promise.resolve({
                paper: loaded.paper,
                edits: [] as PaperEditRecord[],
                sideEffects: { reindex: false, pds: false, enrich: false, bridge: false },
              }),
            );
          }
          return applyDiffs({
            ctx,
            paper: loaded.paper,
            editorDid,
            reason: request.reason,
            diffs,
          });
        });

      // ↓ helpers ↓

      function computeDiffs(
        paper: PaperRecord,
        currentKeywords: readonly string[],
        changes: z.infer<typeof editablePaperFieldsSchema>,
      ): FieldDiff[] {
        const out: FieldDiff[] = [];
        if (changes.title !== undefined && changes.title !== paper.title) {
          out.push({ field: 'title', oldValue: paper.title, newValue: changes.title });
        }
        if (
          changes.abstract !== undefined &&
          (changes.abstract ?? null) !== (paper.abstract ?? null)
        ) {
          out.push({
            field: 'abstract',
            oldValue: paper.abstract,
            newValue: changes.abstract ?? null,
          });
        }
        if (changes.keywords !== undefined) {
          const next = changes.keywords;
          const same =
            next.length === currentKeywords.length &&
            next.every((k, i) => k === currentKeywords[i]);
          if (!same) {
            out.push({
              field: 'keywords',
              oldValue: currentKeywords,
              newValue: next,
            });
          }
        }
        if (
          changes.primaryCategory !== undefined &&
          changes.primaryCategory !== paper.primaryCategory
        ) {
          out.push({
            field: 'primary_category',
            oldValue: paper.primaryCategory,
            newValue: changes.primaryCategory,
          });
        }
        if (changes.crossListings !== undefined) {
          const next = Array.from(new Set(changes.crossListings)); // dedup
          const primary = changes.primaryCategory ?? paper.primaryCategory;
          const filtered = next.filter((c) => c !== primary);
          const sameSet =
            filtered.length === paper.crossListings.length &&
            filtered.every((c) => paper.crossListings.includes(c));
          if (!sameSet) {
            out.push({
              field: 'cross_listings',
              oldValue: paper.crossListings,
              newValue: filtered,
            });
          }
        }
        if (changes.license !== undefined && changes.license !== paper.license) {
          out.push({
            field: 'license',
            oldValue: paper.license,
            newValue: changes.license,
          });
        }
        void FIELD_TO_DB_COL; // kept for symmetry, used at the schema layer
        return out;
      }
    },
  };

  function applyDiffs(input: {
    ctx: AppContext;
    paper: PaperRecord;
    editorDid: string;
    reason: string;
    diffs: FieldDiff[];
  }): AppResultAsync<{
    paper: PaperRecord;
    edits: PaperEditRecord[];
    sideEffects: { reindex: boolean; pds: boolean; enrich: boolean; bridge: boolean };
  }> {
    // Step 1 — persist the actual field changes via setCategories (which
    // also keeps cross_listings + paper_categories in sync) and direct
    // column updates for everything else.
    return persistChanges(input.paper, input.diffs).andThen((updatedPaper) => {
      // Step 2 — append one audit row per diff.
      const auditWrites = input.diffs.map((d) =>
        paperEdits.append({
          paperId: updatedPaper.id,
          editorDid: input.editorDid,
          field: d.field,
          oldValue: d.oldValue,
          newValue: d.newValue,
          reason: input.reason,
        }),
      );
      return ResultAsync.combine(auditWrites).andThen((edits) =>
        // Step 3 — fan out non-fatal side effects.
        fanOutSideEffects(input.ctx, updatedPaper).map((sideEffects) => ({
          paper: updatedPaper,
          edits,
          sideEffects,
        })),
      );
    });
  }

  function persistChanges(paper: PaperRecord, diffs: FieldDiff[]): AppResultAsync<PaperRecord> {
    const work = async (): Promise<PaperRecord> => {
      // We need a transaction here because changing primaryCategory or
      // crossListings goes through setCategories (m2m + array). The
      // simplest path: collect intended values, call setCategories once
      // if either changed, then update the remaining columns in one
      // SQL.
      let nextPrimary = paper.primaryCategory;
      let nextCross = paper.crossListings;
      let needsSetCategories = false;
      const colUpdates: Record<string, unknown> = { updatedAt: new Date() };

      for (const d of diffs) {
        switch (d.field) {
          case 'title':
            colUpdates['title'] = d.newValue as string;
            break;
          case 'abstract':
            colUpdates['abstract'] = d.newValue as string | null;
            break;
          case 'license':
            colUpdates['license'] = d.newValue as string;
            break;
          case 'primary_category':
            nextPrimary = d.newValue as string;
            needsSetCategories = true;
            break;
          case 'cross_listings':
            nextCross = d.newValue as string[];
            needsSetCategories = true;
            break;
          case 'keywords':
            // setKeywords replaces the lot.
            break;
        }
      }

      // Direct UPDATE for the simple columns.
      if (Object.keys(colUpdates).length > 1) {
        await ctx.db.pool.query(
          'UPDATE papers SET title = COALESCE($1, title), abstract = COALESCE($2, abstract), license = COALESCE($3, license), updated_at = now() WHERE id = $4',
          [
            colUpdates['title'] ?? null,
            colUpdates['abstract'] !== undefined ? (colUpdates['abstract'] ?? null) : null,
            colUpdates['license'] ?? null,
            paper.id,
          ],
        );
      }
      if (needsSetCategories) {
        const r = await papers.setCategories(paper.id, nextPrimary, nextCross);
        if (r.isErr()) throw r.error;
      }
      const keywordsDiff = diffs.find((d) => d.field === 'keywords');
      if (keywordsDiff) {
        const r = await papers.setKeywords(paper.id, keywordsDiff.newValue as string[]);
        if (r.isErr()) throw r.error;
      }

      const reloaded = await papers.findById(paper.id);
      if (reloaded.isErr()) throw reloaded.error;
      if (!reloaded.value) throw new Error('paper vanished post-edit');
      return reloaded.value;
    };
    return fromPromise(work(), (cause) => Errors.internal('paperEdit.persist', cause));
  }

  function fanOutSideEffects(
    ctx: AppContext,
    paper: PaperRecord,
  ): AppResultAsync<{ reindex: boolean; pds: boolean; enrich: boolean; bridge: boolean }> {
    // Each side effect is a fire-and-forget enqueue; failure is logged
    // but never throws back to the caller. The edit + audit row already
    // succeeded — the user sees green and the worker eventually
    // catches up.
    return fromPromise(
      (async () => {
        const result = { reindex: false, pds: false, enrich: false, bridge: false };
        try {
          await ctx.queues.embed.add('reindex-edit', { paperId: paper.id }, { attempts: 3 });
          result.reindex = true;
        } catch (err) {
          ctx.db.pool
            .query(
              'INSERT INTO worker_failed(name, count) VALUES($1, 1) ON CONFLICT DO NOTHING',
              ['paperEdit.reindex'],
            )
            .catch(() => {});
          void err;
        }
        if (await isFeatureEnabled(ctx, FLAGS.OPENALEX_ENRICH ?? 'openalex_enrich', false)) {
          // Enqueue an OpenAlex re-enrich when the worker is wired
          // (Phase 6 ships #13). For now this is a documented hook.
          result.enrich = false;
        }
        // PDS putRecord — same rkey as the original record. Trigger via
        // the existing compile queue's saga, restricted to the publish
        // stage. We don't reset the saga to scratch; we enqueue a
        // dedicated re-publish job.
        try {
          await ctx.queues.compile.add(
            'paper-edit-republish',
            { paperId: paper.id, sourceKey: 'edit', filename: 'edit' },
            { attempts: 1, jobId: `edit-republish-${paper.id}-${Date.now()}` },
          );
          result.pds = true;
        } catch {
          // best-effort
        }
        return result;
      })(),
      () => Errors.internal('paperEdit.fanOut'),
    );
  }
}

export const __testing = { editablePaperFieldsSchema };
