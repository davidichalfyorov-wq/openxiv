import { Errors, fromPromise, makeAtUri, parseAtUri } from '@openxiv/shared';
import { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeoutRetry } from '../http.js';
import type { AtProtoPdsClient, PutRecordInput, UploadBlobResult } from './interface.js';

export interface PdsConfig {
  readonly serviceUrl: string;
}

/**
 * Talks to an AT-proto PDS (typically bsky.social) using its XRPC HTTP API.
 * For the App View pattern, writes go to the user's own PDS — so the caller
 * must pass an access JWT obtained via OAuth.
 */
export function makeAtProtoPdsClient(cfg: PdsConfig): AtProtoPdsClient {
  async function xrpcPost<T>(
    nsid: string,
    body: unknown,
    accessJwt?: string,
    isBlob?: { mime: string },
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (accessJwt) headers['authorization'] = `Bearer ${accessJwt}`;
    headers['content-type'] = isBlob ? isBlob.mime : 'application/json';
    const res = await fetchWithTimeoutRetry(`${cfg.serviceUrl}/xrpc/${nsid}`, {
      method: 'POST',
      headers,
      body: isBlob ? (body as Buffer) : JSON.stringify(body),
      timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
    });
    if (!res.ok) {
      throw new Error(`pds ${nsid} ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  async function xrpcGet<T>(nsid: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${cfg.serviceUrl}/xrpc/${nsid}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchWithTimeoutRetry(url.toString(), {
      timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
    });
    if (!res.ok) {
      throw new Error(`pds ${nsid} ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  return {
    putRecord(input: PutRecordInput) {
      const work = async (): Promise<{ uri: string; cid: string }> => {
        const result = await xrpcPost<{ uri: string; cid: string }>(
          'com.atproto.repo.putRecord',
          {
            repo: input.repo,
            collection: input.collection,
            rkey: input.rkey,
            record: { $type: input.collection, ...input.record },
          },
          input.accessJwt,
        );
        return result;
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('pds.putRecord', cause),
      );
    },
    uploadBlob({ data, mimeType, accessJwt }) {
      const work = async (): Promise<UploadBlobResult> => {
        const result = await xrpcPost<{ blob: UploadBlobResult }>(
          'com.atproto.repo.uploadBlob',
          data,
          accessJwt,
          { mime: mimeType },
        );
        return result.blob;
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('pds.uploadBlob', cause),
      );
    },
    getRecord({ uri }) {
      const parts = parseAtUri(uri);
      if (!parts) {
        return fromPromise(Promise.reject(new Error('bad at-uri')), () =>
          Errors.validation('invalid at-uri'),
        );
      }
      const work = async (): Promise<Record<string, unknown>> => {
        const res = await xrpcGet<{ value: Record<string, unknown> }>(
          'com.atproto.repo.getRecord',
          { repo: parts.did, collection: parts.collection, rkey: parts.rkey },
        );
        return res.value;
      };
      return fromPromise(work(), (cause) =>
        Errors.externalInvalidResponse('pds.getRecord', cause),
      );
    },
  };
}

// keep import — used by getRecord assembly elsewhere
void makeAtUri;
