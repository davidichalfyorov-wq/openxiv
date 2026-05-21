import type { AppResultAsync } from '@openxiv/shared';

export interface PutRecordInput {
  readonly repo: string;
  readonly collection: string;
  readonly rkey?: string;
  readonly record: Record<string, unknown>;
  readonly accessJwt?: string;
}

export interface PutRecordResult {
  readonly uri: string;
  readonly cid: string;
}

export interface UploadBlobResult {
  readonly $type: 'blob';
  readonly ref: { $link: string };
  readonly mimeType: string;
  readonly size: number;
}

export interface AtProtoPdsClient {
  putRecord(input: PutRecordInput): AppResultAsync<PutRecordResult>;
  uploadBlob(
    input: { repo: string; data: Buffer; mimeType: string; accessJwt?: string },
  ): AppResultAsync<UploadBlobResult>;
  getRecord(input: { uri: string }): AppResultAsync<Record<string, unknown>>;
}
