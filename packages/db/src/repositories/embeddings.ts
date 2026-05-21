import { sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { paperEmbeddings } from '../schema/embeddings.js';

export interface EmbeddingsRepository {
  upsert(input: {
    paperId: string;
    embedding: number[];
    model: string;
    dim: number;
  }): AppResultAsync<void>;
  similar(embedding: number[], limit?: number): AppResultAsync<Array<{ paperId: string; distance: number }>>;
  forPaper(paperId: string): AppResultAsync<{ embedding: number[]; model: string } | null>;
}

export function makeEmbeddingsRepository(db: Database): EmbeddingsRepository {
  return {
    upsert(input) {
      return fromPromise(
        db
          .insert(paperEmbeddings)
          .values({
            paperId: input.paperId,
            embedding: input.embedding,
            model: input.model,
            dim: input.dim,
          })
          .onConflictDoUpdate({
            target: paperEmbeddings.paperId,
            set: {
              embedding: input.embedding,
              model: input.model,
              dim: input.dim,
              createdAt: new Date(),
            },
          }),
        (cause) => Errors.internal('embeddings.upsert', cause),
      ).map(() => undefined);
    },
    similar(embedding, limit = 20) {
      const vec = `[${embedding.join(',')}]`;
      const query = sql<{ paper_id: string; distance: number }>`
        select paper_id, embedding <=> ${vec}::vector as distance
        from paper_embeddings
        order by embedding <=> ${vec}::vector
        limit ${limit}
      `;
      return fromPromise(db.execute(query), (cause) =>
        Errors.internal('embeddings.similar', cause),
      ).map((res) =>
        (res.rows as Array<{ paper_id: string; distance: number | string }>).map((r) => ({
          paperId: r.paper_id,
          distance: typeof r.distance === 'string' ? Number(r.distance) : r.distance,
        })),
      );
    },
    forPaper(paperId) {
      return fromPromise(
        db
          .select({ embedding: paperEmbeddings.embedding, model: paperEmbeddings.model })
          .from(paperEmbeddings)
          .where(sql`${paperEmbeddings.paperId} = ${paperId}`)
          .limit(1),
        (cause) => Errors.internal('embeddings.forPaper', cause),
      ).map((rows) => rows[0] ?? null);
    },
  };
}
