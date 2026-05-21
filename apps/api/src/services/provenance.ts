/**
 * Reader-facing Provenance Timeline.
 *
 * The submission saga (apps/api/src/services/submissions.ts) writes pipeline
 * state into `submission_sagas` for our own retry logic. That table includes
 * raw error text and per-stage booleans which we keep gated to the submitter
 * and moderators — third parties have no reason to know which internal stage
 * failed.
 *
 * What third parties *do* care about, and what builds reader trust, is the
 * public history of how the paper got from upload to indexed to bridged.
 * That story is reconstructable from publicly-observable fields alone:
 *   - `papers.created_at`           → uploaded
 *   - `paper_versions.pdf_key`      → PDF compiled
 *   - `paper_versions.html_key`     → HTML compiled
 *   - `disclosures.created_at`      → AI disclosure recorded
 *   - `papers.uri`                  → mirrored to PDS (record exists ⇒ done)
 *   - `papers.openxiv_id`           → OpenXiv id allocated
 *   - `papers.published_at`         → publication moment
 *   - `paper_sections` row count    → indexed for semantic search
 *   - saga.stageBlueskyBridge       → bridged to Bluesky
 *
 * For stages that have a precise timestamp on a public row, we surface it.
 * For stages that complete asynchronously without a dedicated `*_at` column
 * (PDS mirror, bridge), we surface only `done: true` with `completedAt: null`
 * — better honest than a fake timestamp.
 *
 * The whole timeline degrades cleanly: if the database has nothing past
 * "uploaded", we still render that one stage and the remaining seven sit at
 * pending. Readers see progress, not breakage.
 */

import type { PaperWithRelations } from '@openxiv/db';

export type ProvenanceStageKey =
  | 'uploaded'
  | 'compiled_pdf'
  | 'compiled_html'
  | 'metadata'
  | 'disclosure'
  | 'pds'
  | 'id'
  | 'indexed'
  | 'bridged';

export interface ProvenanceStage {
  key: ProvenanceStageKey;
  label: string;
  done: boolean;
  completedAt: string | null;
}

export interface ProvenanceTimeline {
  stages: ProvenanceStage[];
  /** 0..1 — how many stages are `done`. Useful for a progress dot. */
  completion: number;
}

export interface ProvenanceInputs {
  loaded: PaperWithRelations;
  /**
   * Earliest createdAt across `paper_sections` for this paper, if any rows
   * exist. The caller queries this separately to keep this function pure.
   */
  sectionsFirstIndexedAt: Date | null;
  /**
   * `true` if the saga's `stage_bluesky_bridge` flag is set. This is the
   * only saga bit we surface publicly — it represents a *positive* social
   * broadcast that's already visible on Bluesky itself, so showing it on
   * our own timeline leaks nothing new.
   */
  bridgeDone: boolean;
}

const LABELS: Record<ProvenanceStageKey, string> = {
  uploaded: 'Source uploaded',
  compiled_pdf: 'PDF compiled',
  compiled_html: 'HTML compiled',
  metadata: 'Metadata fixed (title, authors, categories)',
  disclosure: 'AI disclosure recorded',
  pds: 'Mirrored to AT-Proto PDS',
  id: 'OpenXiv id assigned',
  indexed: 'Indexed for semantic search',
  bridged: 'Bridged to Bluesky',
};

export function buildProvenanceTimeline(inputs: ProvenanceInputs): ProvenanceTimeline {
  const { loaded, sectionsFirstIndexedAt, bridgeDone } = inputs;
  const paper = loaded.paper;

  const stages: ProvenanceStage[] = [
    {
      key: 'uploaded',
      label: LABELS.uploaded,
      done: true, // having a paper row means upload happened
      completedAt: paper.createdAt.toISOString(),
    },
    {
      key: 'compiled_pdf',
      label: LABELS.compiled_pdf,
      done: Boolean(loaded.latestVersion?.pdfKey || loaded.latestVersion?.finalPdfUrl),
      completedAt:
        loaded.latestVersion?.pdfKey || loaded.latestVersion?.finalPdfUrl
          ? loaded.latestVersion.createdAt.toISOString()
          : null,
    },
    {
      key: 'compiled_html',
      label: LABELS.compiled_html,
      done: Boolean(loaded.latestVersion?.htmlKey),
      completedAt: loaded.latestVersion?.htmlKey
        ? loaded.latestVersion.createdAt.toISOString()
        : null,
    },
    (() => {
      const done =
        Boolean(paper.title) &&
        loaded.authors.length > 0 &&
        loaded.categories.length > 0;
      return {
        key: 'metadata' as const,
        label: LABELS.metadata,
        done,
        completedAt: done ? paper.createdAt.toISOString() : null,
      };
    })(),
    {
      key: 'disclosure',
      label: LABELS.disclosure,
      done: loaded.disclosure !== null,
      completedAt: loaded.disclosure?.createdAt.toISOString() ?? null,
    },
    {
      key: 'pds',
      label: LABELS.pds,
      done: Boolean(paper.uri && paper.uri.startsWith('at://')),
      // `papers.uri` doesn't carry its own write timestamp — `updated_at`
      // is the closest proxy. Surfacing null would also be honest but the
      // PDS write completes very close to publish, so updatedAt is good.
      completedAt: paper.uri ? paper.updatedAt.toISOString() : null,
    },
    {
      key: 'id',
      label: LABELS.id,
      done: Boolean(paper.openxivId),
      completedAt: paper.publishedAt?.toISOString() ?? null,
    },
    {
      key: 'indexed',
      label: LABELS.indexed,
      done: sectionsFirstIndexedAt !== null,
      completedAt: sectionsFirstIndexedAt?.toISOString() ?? null,
    },
    {
      key: 'bridged',
      label: LABELS.bridged,
      done: bridgeDone,
      // saga has no per-stage timestamp; if the bridge happened we leave
      // completedAt null and let the UI show "done" without a date.
      completedAt: null,
    },
  ];

  const completion = stages.filter((s) => s.done).length / stages.length;
  return { stages, completion };
}
