import { describe, expect, it } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import {
  withCompilerBreaker,
  withGrobidBreaker,
  withLatexmlBreaker,
  withOAuthBreaker,
  withPdsBreaker,
  withStorageBreaker,
} from './external-breakers.js';
import type { LatexCompiler } from './compiler/interface.js';
import type { GrobidExtractor } from './grobid/interface.js';
import type { LatexmlConverter } from './latexml/interface.js';
import type { OAuthClient } from './oauth/interface.js';
import type { AtProtoPdsClient } from './pds/interface.js';
import type { StorageClient } from './storage/interface.js';

describe('external client breaker wrappers', () => {
  it('wraps storage operations without changing the StorageClient contract', async () => {
    const storage: StorageClient = {
      put: () => ResultAsync.fromSafePromise(Promise.resolve({ key: 'k', etag: 'e' })),
      get: () =>
        ResultAsync.fromSafePromise(
          Promise.resolve({ key: 'k', contentType: 'text/plain', body: Buffer.from('x') }),
        ),
      delete: () => ResultAsync.fromSafePromise(Promise.resolve()),
      presignGet: () => ResultAsync.fromSafePromise(Promise.resolve('https://s3/get')),
      presignPut: () =>
        ResultAsync.fromSafePromise(Promise.resolve({ url: 'https://s3/put', headers: {} })),
    };
    const wrapped = withStorageBreaker(storage, { name: 's3', timeoutMs: 200 });

    await expect(wrapped.put('k', Buffer.from('x'))).resolves.toMatchObject({ value: { key: 'k' } });
    await expect(wrapped.get('k')).resolves.toMatchObject({ value: { contentType: 'text/plain' } });
    await expect(wrapped.delete('k')).resolves.toMatchObject({ value: undefined });
    await expect(wrapped.presignGet('k', 60)).resolves.toMatchObject({ value: 'https://s3/get' });
    await expect(wrapped.presignPut('k', 'text/plain', 60)).resolves.toMatchObject({
      value: { url: 'https://s3/put' },
    });
  });

  it('wraps metadata, compiler, and LaTeXML clients without changing contracts', async () => {
    const grobid: GrobidExtractor = {
      extract: () =>
        ResultAsync.fromSafePromise(
          Promise.resolve({ authors: [], references: [], bodyText: 'body' }),
        ),
    };
    const compiler: LatexCompiler = {
      compile: () =>
        ResultAsync.fromSafePromise(
          Promise.resolve({ pdf: Buffer.from('%PDF-'), log: 'ok', durationMs: 1 }),
        ),
    };
    const latexml: LatexmlConverter = {
      convertToHtml: () =>
        ResultAsync.fromSafePromise(
          Promise.resolve({ html: Buffer.from('<html></html>'), log: 'ok' }),
        ),
    };

    await expect(withGrobidBreaker(grobid, { name: 'grobid', timeoutMs: 200 }).extract(Buffer.from('pdf')))
      .resolves.toMatchObject({ value: { bodyText: 'body' } });
    await expect(withCompilerBreaker(compiler, { name: 'tectonic', timeoutMs: 200 }).compile({
      source: Buffer.from('\\documentclass{article}'),
      filename: 'main.tex',
    })).resolves.toMatchObject({ value: { log: 'ok' } });
    await expect(withLatexmlBreaker(latexml, { name: 'latexml', timeoutMs: 200 }).convertToHtml({
      source: Buffer.from('\\documentclass{article}'),
      filename: 'main.tex',
    })).resolves.toMatchObject({ value: { log: 'ok' } });
  });

  it('wraps OAuth exchange and PDS operations without changing contracts', async () => {
    const oauth: OAuthClient = {
      provider: 'orcid',
      authorizeUrl: () =>
        ResultAsync.fromSafePromise(Promise.resolve({ url: 'https://orcid.org/oauth', state: 's' })),
      exchange: () =>
        ResultAsync.fromSafePromise(
          Promise.resolve({ provider: 'orcid', subject: '0000', displayName: 'ORCID User' }),
        ),
    };
    const pds: AtProtoPdsClient = {
      putRecord: () =>
        ResultAsync.fromSafePromise(Promise.resolve({ uri: 'at://did/app.record/1', cid: 'cid' })),
      uploadBlob: () =>
        ResultAsync.fromSafePromise(
          Promise.resolve({ $type: 'blob', ref: { $link: 'cid' }, mimeType: 'text/plain', size: 1 }),
        ),
      getRecord: () => ResultAsync.fromSafePromise(Promise.resolve({ text: 'ok' })),
    };

    await expect(withOAuthBreaker(oauth, { name: 'orcid', timeoutMs: 200 }).authorizeUrl())
      .resolves.toMatchObject({ value: { state: 's' } });
    await expect(withOAuthBreaker(oauth, { name: 'orcid', timeoutMs: 200 }).exchange({
      code: 'c',
      state: 's',
    })).resolves.toMatchObject({ value: { displayName: 'ORCID User' } });
    await expect(withPdsBreaker(pds, { name: 'pds', timeoutMs: 200 }).putRecord({
      repo: 'did:plc:abc',
      collection: 'app.openxiv.paper',
      record: {},
    })).resolves.toMatchObject({ value: { cid: 'cid' } });
    await expect(withPdsBreaker(pds, { name: 'pds', timeoutMs: 200 }).uploadBlob({
      repo: 'did:plc:abc',
      data: Buffer.from('x'),
      mimeType: 'text/plain',
    })).resolves.toMatchObject({ value: { size: 1 } });
    await expect(withPdsBreaker(pds, { name: 'pds', timeoutMs: 200 }).getRecord({
      uri: 'at://did:plc:abc/app.openxiv.paper/1',
    })).resolves.toMatchObject({ value: { text: 'ok' } });
  });
});
