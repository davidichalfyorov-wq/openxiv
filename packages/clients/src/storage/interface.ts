import type { AppResultAsync } from '@openxiv/shared';

export interface StorageObject {
  readonly key: string;
  readonly contentType: string;
  readonly body: Buffer;
}

export interface PutOptions {
  readonly contentType?: string;
  readonly metadata?: Record<string, string>;
  readonly cacheControl?: string;
}

export interface StorageClient {
  put(key: string, body: Buffer | Uint8Array, options?: PutOptions): AppResultAsync<{ key: string; etag?: string }>;
  get(key: string): AppResultAsync<StorageObject>;
  delete(key: string): AppResultAsync<void>;
  presignGet(key: string, expiresSec: number): AppResultAsync<string>;
  presignPut(
    key: string,
    contentType: string,
    expiresSec: number,
  ): AppResultAsync<{ url: string; headers: Record<string, string> }>;
}
