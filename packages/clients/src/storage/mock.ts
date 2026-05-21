import { Errors, type AppResultAsync, fromPromise, ok, ResultAsync } from '@openxiv/shared';
import type { StorageClient, StorageObject } from './interface.js';

/**
 * In-memory storage for tests + dev when MinIO is unavailable. Presigned URLs
 * point at a fake `/__mock-storage/...` path the API will proxy if mounted.
 */
export function makeMockStorageClient(initial?: Map<string, StorageObject>): StorageClient & {
  readonly store: Map<string, StorageObject>;
} {
  const store = initial ?? new Map<string, StorageObject>();
  return {
    store,
    put(key, body, options = {}) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      store.set(key, {
        key,
        contentType: options.contentType ?? 'application/octet-stream',
        body: buf,
      });
      return ResultAsync.fromSafePromise(Promise.resolve({ key, etag: `mock-${buf.length}` }));
    },
    get(key): AppResultAsync<StorageObject> {
      const found = store.get(key);
      if (!found) {
        return fromPromise(
          Promise.reject(new Error(`mock storage miss: ${key}`)),
          () => Errors.notFound(`object ${key} not found in mock storage`),
        );
      }
      return ResultAsync.fromSafePromise(Promise.resolve(found));
    },
    delete(key) {
      store.delete(key);
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
    presignGet(key, expiresSec) {
      const url = `/__mock-storage/${encodeURIComponent(key)}?expires=${expiresSec}`;
      return ResultAsync.fromSafePromise(Promise.resolve(url));
    },
    presignPut(key, contentType, expiresSec) {
      const url = `/__mock-storage/${encodeURIComponent(key)}?put=1&expires=${expiresSec}`;
      return ResultAsync.fromSafePromise(
        Promise.resolve({ url, headers: { 'Content-Type': contentType } }),
      );
    },
  };
}

void ok;
