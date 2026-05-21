import type { AppResultAsync } from '@openxiv/shared';
import { wrapBreaker } from './circuit.js';
import type { CompileInput, CompileResult, LatexCompiler } from './compiler/interface.js';
import type { ExtractedMetadata, GrobidExtractor } from './grobid/interface.js';
import type { ConvertInput, LatexmlConverter } from './latexml/interface.js';
import type { AuthorizeUrl, OAuthClient, OAuthProfile } from './oauth/interface.js';
import type {
  AtProtoPdsClient,
  PutRecordInput,
  PutRecordResult,
  UploadBlobResult,
} from './pds/interface.js';
import type { PutOptions, StorageClient, StorageObject } from './storage/interface.js';

export interface ExternalBreakerOptions {
  readonly name: string;
  readonly timeoutMs: number;
}

export function withStorageBreaker(inner: StorageClient, opts: ExternalBreakerOptions): StorageClient {
  const put = wrapBreaker<
    { key: string; body: Buffer | Uint8Array; options?: PutOptions },
    { key: string; etag?: string }
  >({ name: `${opts.name}.put`, timeoutMs: opts.timeoutMs }, async (input) =>
    unwrap(inner.put(input.key, input.body, input.options)),
  );
  const get = wrapBreaker<string, StorageObject>(
    { name: `${opts.name}.get`, timeoutMs: opts.timeoutMs },
    async (key) => unwrap(inner.get(key)),
  );
  const del = wrapBreaker<string, void>(
    { name: `${opts.name}.delete`, timeoutMs: opts.timeoutMs },
    async (key) => unwrap(inner.delete(key)),
  );
  const presignGet = wrapBreaker<{ key: string; expiresSec: number }, string>(
    { name: `${opts.name}.presignGet`, timeoutMs: opts.timeoutMs },
    async ({ key, expiresSec }) => unwrap(inner.presignGet(key, expiresSec)),
  );
  const presignPut = wrapBreaker<
    { key: string; contentType: string; expiresSec: number },
    { url: string; headers: Record<string, string> }
  >({ name: `${opts.name}.presignPut`, timeoutMs: opts.timeoutMs }, async (input) =>
    unwrap(inner.presignPut(input.key, input.contentType, input.expiresSec)),
  );

  return {
    put(key, body, options) {
      return put({ key, body, ...(options ? { options } : {}) });
    },
    get(key) {
      return get(key);
    },
    delete(key) {
      return del(key);
    },
    presignGet(key, expiresSec) {
      return presignGet({ key, expiresSec });
    },
    presignPut(key, contentType, expiresSec) {
      return presignPut({ key, contentType, expiresSec });
    },
  };
}

export function withGrobidBreaker(inner: GrobidExtractor, opts: ExternalBreakerOptions): GrobidExtractor {
  const extract = wrapBreaker<Buffer, ExtractedMetadata>(
    { name: `${opts.name}.extract`, timeoutMs: opts.timeoutMs },
    async (pdf) => unwrap(inner.extract(pdf)),
  );
  return {
    extract(pdf) {
      return extract(pdf);
    },
  };
}

export function withCompilerBreaker(inner: LatexCompiler, opts: ExternalBreakerOptions): LatexCompiler {
  const compile = wrapBreaker<CompileInput, CompileResult>(
    { name: `${opts.name}.compile`, timeoutMs: opts.timeoutMs },
    async (input) => unwrap(inner.compile(input)),
  );
  return {
    compile(input) {
      return compile(input);
    },
  };
}

export function withLatexmlBreaker(inner: LatexmlConverter, opts: ExternalBreakerOptions): LatexmlConverter {
  const convertToHtml = wrapBreaker<ConvertInput, { html: Buffer; log: string }>(
    { name: `${opts.name}.convertToHtml`, timeoutMs: opts.timeoutMs },
    async (input) => unwrap(inner.convertToHtml(input)),
  );
  return {
    convertToHtml(input) {
      return convertToHtml(input);
    },
  };
}

export function withOAuthBreaker(inner: OAuthClient, opts: ExternalBreakerOptions): OAuthClient {
  const exchange = wrapBreaker<
    { code: string; state: string; codeVerifier?: string; nonce?: string },
    OAuthProfile
  >({ name: `${opts.name}.exchange`, timeoutMs: opts.timeoutMs }, async (params) =>
    unwrap(inner.exchange(params)),
  );
  return {
    provider: inner.provider,
    authorizeUrl(redirectAfter, options): AppResultAsync<AuthorizeUrl> {
      return inner.authorizeUrl(redirectAfter, options);
    },
    exchange(params) {
      return exchange(params);
    },
  };
}

export function withPdsBreaker(inner: AtProtoPdsClient, opts: ExternalBreakerOptions): AtProtoPdsClient {
  const putRecord = wrapBreaker<PutRecordInput, PutRecordResult>(
    { name: `${opts.name}.putRecord`, timeoutMs: opts.timeoutMs },
    async (input) => unwrap(inner.putRecord(input)),
  );
  const uploadBlob = wrapBreaker<
    { repo: string; data: Buffer; mimeType: string; accessJwt?: string },
    UploadBlobResult
  >({ name: `${opts.name}.uploadBlob`, timeoutMs: opts.timeoutMs }, async (input) =>
    unwrap(inner.uploadBlob(input)),
  );
  const getRecord = wrapBreaker<{ uri: string }, Record<string, unknown>>(
    { name: `${opts.name}.getRecord`, timeoutMs: opts.timeoutMs },
    async (input) => unwrap(inner.getRecord(input)),
  );

  return {
    putRecord(input) {
      return putRecord(input);
    },
    uploadBlob(input) {
      return uploadBlob(input);
    },
    getRecord(input) {
      return getRecord(input);
    },
  };
}

async function unwrap<T>(result: AppResultAsync<T>): Promise<T> {
  const resolved = await result;
  if (resolved.isErr()) throw resolved.error;
  return resolved.value;
}
