import { ResultAsync, generateTid, makeAtUri, sha256Hex } from '@openxiv/shared';
import type {
  AtProtoPdsClient,
  PutRecordInput,
  PutRecordResult,
  UploadBlobResult,
} from './interface.js';

/**
 * In-memory mock PDS. Records and blobs are persisted in maps for the lifetime
 * of the process. Useful for the MVP happy-path: API can pretend to publish to
 * a PDS without an actual Bluesky account.
 */
export function makeMockPdsClient(): AtProtoPdsClient & {
  readonly records: Map<string, Record<string, unknown>>;
  readonly blobs: Map<string, Buffer>;
} {
  const records = new Map<string, Record<string, unknown>>();
  const blobs = new Map<string, Buffer>();

  return {
    records,
    blobs,
    putRecord(input: PutRecordInput) {
      const rkey = input.rkey ?? generateTid();
      const uri = makeAtUri(input.repo, input.collection, rkey);
      records.set(uri, { $type: input.collection, ...input.record });
      const cid = `bafkrei${sha256Hex(JSON.stringify(input.record)).slice(0, 50)}`;
      const result: PutRecordResult = { uri, cid };
      return ResultAsync.fromSafePromise(Promise.resolve(result));
    },
    uploadBlob({ data, mimeType }) {
      const link = `bafkrei${sha256Hex(data).slice(0, 50)}`;
      blobs.set(link, Buffer.from(data));
      const result: UploadBlobResult = {
        $type: 'blob',
        ref: { $link: link },
        mimeType,
        size: data.length,
      };
      return ResultAsync.fromSafePromise(Promise.resolve(result));
    },
    getRecord({ uri }) {
      const found = records.get(uri);
      if (!found) {
        return ResultAsync.fromSafePromise(Promise.resolve({} as Record<string, unknown>));
      }
      return ResultAsync.fromSafePromise(Promise.resolve(found));
    },
  };
}
