import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3ClientConfig,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Errors, fromPromise } from '@openxiv/shared';
import type { PutOptions, StorageClient, StorageObject } from './interface.js';

export interface S3StorageConfig {
  readonly endpoint: string;
  readonly publicEndpoint?: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
}

export const S3_REQUEST_TIMEOUT_MS = 10_000;
export const S3_MAX_ATTEMPTS = 3;

export function buildS3ClientRuntimeConfig(cfg: S3StorageConfig): S3ClientConfig {
  return {
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: cfg.forcePathStyle,
    maxAttempts: S3_MAX_ATTEMPTS,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: S3_REQUEST_TIMEOUT_MS,
      requestTimeout: S3_REQUEST_TIMEOUT_MS,
    }),
  };
}

/**
 * Two underlying clients: `internal` is used by server-side put/get/delete;
 * `public` is used only to construct presigned URLs handed to browsers.
 * In docker-compose these are http://minio:9000 and http://localhost:9000.
 */
export function makeS3StorageClient(cfg: S3StorageConfig): StorageClient {
  const internal = new S3Client(buildS3ClientRuntimeConfig(cfg));
  const publicClient =
    cfg.publicEndpoint && cfg.publicEndpoint !== cfg.endpoint
      ? new S3Client(buildS3ClientRuntimeConfig({ ...cfg, endpoint: cfg.publicEndpoint }))
      : internal;

  async function streamToBuffer(stream: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(stream)) return stream;
    if (stream instanceof Uint8Array) return Buffer.from(stream);
    if (typeof stream === 'string') return Buffer.from(stream);
    // AWS SDK v3: stream is Node.js Readable. Use transformToByteArray helper when available.
    if (stream && typeof stream === 'object' && 'transformToByteArray' in stream) {
      const bytes = await (stream as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
      return Buffer.from(bytes);
    }
    if (stream && typeof stream === 'object' && Symbol.asyncIterator in stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    throw new Error('unsupported S3 body type');
  }

  return {
    put(key, body, options: PutOptions = {}) {
      const cmd = new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: Buffer.isBuffer(body) ? body : Buffer.from(body),
        ContentType: options.contentType ?? 'application/octet-stream',
        Metadata: options.metadata,
        CacheControl: options.cacheControl,
      });
      return fromPromise(internal.send(cmd), (cause) =>
        Errors.storage(`s3.put failed: ${key}`, cause),
      ).map((res) => ({ key, ...(res.ETag ? { etag: res.ETag } : {}) }));
    },
    get(key) {
      const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
      const work = async (): Promise<StorageObject> => {
        const res = await internal.send(cmd);
        if (!res.Body) throw new Error('empty body');
        const buffer = await streamToBuffer(res.Body);
        return {
          key,
          contentType: res.ContentType ?? 'application/octet-stream',
          body: buffer,
        };
      };
      return fromPromise(work(), (cause) => Errors.storage(`s3.get failed: ${key}`, cause));
    },
    delete(key) {
      const cmd = new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key });
      return fromPromise(internal.send(cmd), (cause) =>
        Errors.storage(`s3.delete failed: ${key}`, cause),
      ).map(() => undefined);
    },
    presignGet(key, expiresSec) {
      const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
      return fromPromise(
        getSignedUrl(publicClient, cmd, { expiresIn: expiresSec }),
        (cause) => Errors.storage(`s3.presignGet failed: ${key}`, cause),
      );
    },
    presignPut(key, contentType, expiresSec) {
      const cmd = new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        ContentType: contentType,
      });
      const work = async (): Promise<{ url: string; headers: Record<string, string> }> => {
        const url = await getSignedUrl(publicClient, cmd, { expiresIn: expiresSec });
        return { url, headers: { 'Content-Type': contentType } };
      };
      return fromPromise(work(), (cause) =>
        Errors.storage(`s3.presignPut failed: ${key}`, cause),
      );
    },
  };
}
