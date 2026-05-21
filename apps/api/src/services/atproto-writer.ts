import type { AppResultAsync } from '@openxiv/shared';
import type { PutRecordResult } from '@openxiv/clients';
import type { AppContext } from '../context.js';

export interface AtProtoWriteInput {
  readonly repo: string;
  readonly collection: string;
  readonly rkey?: string;
  readonly record: Record<string, unknown>;
}

export function putAtProtoRecord(
  ctx: AppContext,
  input: AtProtoWriteInput,
): AppResultAsync<PutRecordResult> {
  if (input.repo.startsWith('did:plc:')) {
    return ctx.clients.bluesky.restoreSession(input.repo).andThen((session) =>
      session.post<PutRecordResult>('com.atproto.repo.putRecord', {
        repo: session.did,
        collection: input.collection,
        ...(input.rkey ? { rkey: input.rkey } : {}),
        record: { $type: input.collection, ...input.record },
      }),
    );
  }
  return ctx.clients.pds.putRecord(input);
}
