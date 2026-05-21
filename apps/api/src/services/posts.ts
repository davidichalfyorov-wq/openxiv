import { Errors, type AppResultAsync, ResultAsync, generateTid } from '@openxiv/shared';
import { postRecordSchema } from '@openxiv/lexicons';
import type { PostRecord } from '@openxiv/db';
import type { AppContext } from '../context.js';

export interface CreatePostInput {
  readonly authorDid: string;
  readonly text: string;
  readonly replyParentUri?: string;
  readonly replyRootUri?: string;
  readonly embedPaperUri?: string;
  readonly tags?: string[];
  readonly langs?: string[];
}

export interface PostsService {
  create(input: CreatePostInput): AppResultAsync<PostRecord>;
}

export function makePostsService(ctx: AppContext): PostsService {
  const { posts } = ctx.repos;
  const { pds } = ctx.clients;

  return {
    create(input) {
      const record = {
        text: input.text,
        ...(input.replyParentUri && input.replyRootUri
          ? {
              reply: {
                root: { uri: input.replyRootUri, cid: 'unknown' },
                parent: { uri: input.replyParentUri, cid: 'unknown' },
              },
            }
          : {}),
        ...(input.embedPaperUri ? { embed: { paperUri: input.embedPaperUri } } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        ...(input.langs?.length ? { langs: input.langs } : {}),
        createdAt: new Date().toISOString(),
      };
      const parsed = postRecordSchema.safeParse(record);
      if (!parsed.success) {
        return ResultAsync.fromPromise(Promise.reject(new Error('bad record')), () =>
          Errors.validation('post lexicon validation', parsed.error.issues),
        );
      }

      return pds
        .putRecord({
          repo: input.authorDid,
          collection: 'app.openxiv.post',
          rkey: generateTid(),
          record: parsed.data as Record<string, unknown>,
        })
        .andThen((written) =>
          posts.create({
            uri: written.uri,
            cid: written.cid,
            authorDid: input.authorDid,
            text: input.text,
            replyRootUri: input.replyRootUri ?? null,
            replyParentUri: input.replyParentUri ?? null,
            embedPaperUri: input.embedPaperUri ?? null,
            embedExternal: null,
            tags: input.tags ?? null,
            langs: input.langs ?? null,
          }),
        );
    },
  };
}
