import { NodeHttpHandler } from '@smithy/node-http-handler';
import { describe, expect, it } from 'vitest';
import {
  S3_MAX_ATTEMPTS,
  S3_REQUEST_TIMEOUT_MS,
  buildS3ClientRuntimeConfig,
  type S3StorageConfig,
} from './s3.js';

describe('buildS3ClientRuntimeConfig', () => {
  it('sets explicit timeout and retry policy for MinIO/S3 calls', async () => {
    const cfg: S3StorageConfig = {
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      bucket: 'openxiv',
      forcePathStyle: true,
    };

    const runtime = buildS3ClientRuntimeConfig(cfg);

    expect(runtime.maxAttempts).toBe(S3_MAX_ATTEMPTS);
    expect(runtime.requestHandler).toBeInstanceOf(NodeHttpHandler);
    const handler = runtime.requestHandler as unknown as {
      readonly configProvider: Promise<{ connectionTimeout?: number; requestTimeout?: number }>;
    };
    await expect(handler.configProvider).resolves.toMatchObject({
      connectionTimeout: S3_REQUEST_TIMEOUT_MS,
      requestTimeout: S3_REQUEST_TIMEOUT_MS,
    });
  });
});
