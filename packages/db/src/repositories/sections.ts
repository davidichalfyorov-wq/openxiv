import { eq, min, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { paperSections } from '../schema/embeddings.js';

export type PaperSectionRecord = typeof paperSections.$inferSelect;
export type NewPaperSection = typeof paperSections.$inferInsert;

export interface SectionMatch {
  paperId: string;
  sectionIdx: number;
  title: string | null;
  anchor: string | null;
  content: string;
  distance: number;
}

export interface SectionsRepository {
  replaceForPaper(
    paperId: string,
    sections: Array<{ sectionIdx: number; title: string | null; anchor: string | null; content: string; embedding: number[]; model: string }>,
  ): AppResultAsync<void>;
  search(embedding: number[], limit?: number): AppResultAsync<SectionMatch[]>;
  forPaper(paperId: string): AppResultAsync<PaperSectionRecord[]>;
  /**
   * Earliest createdAt across all sections for a paper, or `null` if the
   * paper has no indexed sections. Used by the Provenance Timeline to
   * surface a precise "indexed for search" timestamp.
   */
  firstIndexedAt(paperId: string): AppResultAsync<Date | null>;
}

export function makeSectionsRepository(db: Database): SectionsRepository {
  return {
    replaceForPaper(paperId, sections) {
      const work = async (): Promise<void> => {
        await db.delete(paperSections).where(eq(paperSections.paperId, paperId));
        if (sections.length === 0) return;
        const rows: NewPaperSection[] = sections.map((s) => ({
          paperId,
          sectionIdx: s.sectionIdx,
          title: s.title,
          anchor: s.anchor,
          content: s.content,
          embedding: s.embedding,
          model: s.model,
        }));
        await db.insert(paperSections).values(rows);
      };
      return fromPromise(work(), (cause) => Errors.internal('sections.replaceForPaper', cause));
    },
    search(embedding, limit = 20) {
      const vec = `[${embedding.join(',')}]`;
      const query = sql<{
        paper_id: string;
        section_idx: number;
        title: string | null;
        anchor: string | null;
        content: string;
        distance: number;
      }>`
        SELECT paper_id, section_idx, title, anchor, content, embedding <=> ${vec}::vector AS distance
        FROM paper_sections
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${limit}
      `;
      return fromPromise(db.execute(query), (cause) =>
        Errors.internal('sections.search', cause),
      ).map((res) =>
        (res.rows as Array<{
          paper_id: string;
          section_idx: number;
          title: string | null;
          anchor: string | null;
          content: string;
          distance: number | string;
        }>).map((r) => ({
          paperId: r.paper_id,
          sectionIdx: r.section_idx,
          title: r.title,
          anchor: r.anchor,
          content: r.content,
          distance: typeof r.distance === 'string' ? Number(r.distance) : r.distance,
        })),
      );
    },
    forPaper(paperId) {
      return fromPromise(
        db
          .select()
          .from(paperSections)
          .where(eq(paperSections.paperId, paperId))
          .orderBy(paperSections.sectionIdx),
        (cause) => Errors.internal('sections.forPaper', cause),
      );
    },
    firstIndexedAt(paperId) {
      return fromPromise(
        db
          .select({ at: min(paperSections.createdAt) })
          .from(paperSections)
          .where(eq(paperSections.paperId, paperId)),
        (cause) => Errors.internal('sections.firstIndexedAt', cause),
      ).map((rows) => {
        const raw = rows[0]?.at;
        if (!raw) return null;
        return raw instanceof Date ? raw : new Date(raw);
      });
    },
  };
}
