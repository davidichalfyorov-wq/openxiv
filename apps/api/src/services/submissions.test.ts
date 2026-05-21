import { describe, expect, it, vi } from 'vitest';
import { Errors, ResultAsync } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import {
  buildPreprintCompatibilityRecord,
  filenameFromSourceKey,
  socialPushJobOptions,
  makeSubmissionsService,
} from './submissions.js';

function ok<T>(value: T) {
  return ResultAsync.fromSafePromise(Promise.resolve(value));
}

describe('filenameFromSourceKey', () => {
  it('recovers archived source filenames for saga retries', () => {
    expect(
      filenameFromSourceKey(
        'papers/4b8f38b0-d355-4e28-914b-6ea1d4bce17e/v1/source-04_de_sitter_core.zip',
      ),
    ).toBe('04_de_sitter_core.zip');
  });

  it('falls back to main.tex for legacy source keys', () => {
    expect(filenameFromSourceKey('papers/p/v1/source-main.tex')).toBe('main.tex');
    expect(filenameFromSourceKey(null)).toBe('main.tex');
  });
});

describe('buildPreprintCompatibilityRecord', () => {
  it('rewrites only $type for the app.openxiv.preprint alias record', () => {
    const paperRecord = {
      $type: 'app.openxiv.paper',
      title: 'A compatible paper record',
      authors: [{ displayName: 'A. Author' }],
      categories: ['cs.AI'],
      primaryCategory: 'cs.AI',
      crossListings: [],
      abstract: 'An abstract.',
      keywords: ['openxiv'],
      license: 'CC-BY-4.0',
      createdAt: '2026-05-18T12:00:00.000Z',
    };

    const preprint = buildPreprintCompatibilityRecord(paperRecord);

    expect(preprint).toEqual({
      ...paperRecord,
      $type: 'app.openxiv.preprint',
    });
  });
});

describe('socialPushJobOptions', () => {
  it('keeps Mastodon publish jobs idempotent with exponential retry policy', () => {
    expect(socialPushJobOptions('version-123')).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
      removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
      jobId: 'mastodon-crosspost-version-123',
    });
  });
});

describe('makeSubmissionsService runSaga', () => {
  it('does not mark compile done when LaTeXML fails', async () => {
    const paper = {
      id: 'paper-html-required',
      title: 'HTML required before publish',
      abstract: 'Abstract already supplied by the submitter.',
      primaryCategory: 'math-ph',
      status: 'compiling',
      submitterDid: 'did:plc:author123',
      createdAt: new Date('2026-05-20T00:00:00Z'),
      openxivId: null,
      uri: null,
    };
    const addVersion = vi.fn(() => ok({ id: 'version-should-not-exist' }));
    const markStageDone = vi.fn(() => ok(undefined));
    const recordFailure = vi.fn(() => ok(undefined));

    const ctx = {
      env: {
        DETECTOR_BURST_WEIGHT: 0,
        DETECTOR_BINOCULARS_WEIGHT: 0,
        DETECTOR_STYLOMETRIC_WEIGHT: 0,
      },
      clients: {
        storage: {
          get: () => ok({ body: Buffer.from('\\documentclass{article}'), contentType: 'text/x-tex' }),
          put: () => ok(undefined),
        },
        compiler: {
          compile: () => ok({ pdf: Buffer.from('pdf') }),
        },
        latexml: {
          convertToHtml: () =>
            ResultAsync.fromPromise(
              Promise.reject(new Error('openxiv/latexml image not found')),
              (cause) => Errors.externalInvalidResponse('latexml convert failed', cause),
            ),
        },
        grobid: {
          extract: () => ok({ authors: [], references: [], bodyText: 'metadata body' }),
        },
        keywords: {
          extract: () => ok([]),
        },
        detector: {
          score: () => ok({}),
        },
      },
      queues: {
        pdfFigures: { add: vi.fn() },
      },
      repos: {
        papers: {
          findById: () => ok(paper),
          setStatus: () => ok(undefined),
          latestVersion: () => ok(null),
          addVersion,
          setHtmlKey: () => ok({ id: 'version-should-not-update' }),
          setKeywords: () => ok(undefined),
          getDisclosure: () => ok({ level: 'assistant' }),
        },
        sagas: {
          ensure: () =>
            ok({
              paperId: paper.id,
              stagePaperPersisted: false,
              stagePaperApproved: false,
              stageIdAssigned: false,
              stagePdsPaper: false,
              stagePdsSummaryDisclosure: false,
              stageBlueskyBridge: false,
            }),
          markStageDone,
          recordFailure,
          get: () => ok(null),
        },
        idAllocator: {},
      },
    } as unknown as AppContext;

    const result = await makeSubmissionsService(ctx).runSaga({
      paperId: paper.id,
      sourceKey: `papers/${paper.id}/v1/source-paper.tex`,
      filename: 'paper.tex',
      retryCount: 2,
    });

    expect(result.isErr()).toBe(true);
    expect(markStageDone).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      paper.id,
      'stagePaperPersisted',
      expect.stringContaining('"paper_id":"paper-html-required"'),
    );
    expect(recordFailure).toHaveBeenCalledWith(
      paper.id,
      'stagePaperPersisted',
      expect.stringContaining('"retry_count":2'),
    );
  });

  it('enqueues figure extraction as soon as a paper version is compiled for review', async () => {
    const paper = {
      id: 'paper-figures',
      title: 'Compiled paper awaiting moderation',
      abstract: 'Abstract already supplied by the submitter.',
      primaryCategory: 'gr-qc',
      status: 'compiling',
      submitterDid: 'did:plc:author123',
      createdAt: new Date('2026-05-19T00:00:00Z'),
      openxivId: null,
      uri: null,
    };
    const version = {
      id: 'version-figures',
      paperId: paper.id,
      versionNumber: 1,
      pdfKey: `papers/${paper.id}/v1/paper.pdf`,
      sourceKey: `papers/${paper.id}/v1/source-paper.zip`,
      htmlKey: null,
      fileSha256: 'sha',
      sizeBytes: 3,
      pageCount: null,
      publishedAt: null,
      createdAt: new Date('2026-05-19T00:00:01Z'),
    };
    let stagePaperPersisted = false;
    let status = paper.status;
    const pdfFiguresAdd = vi.fn(async () => ({ id: 'figures-job-1' }));

    const ctx = {
      env: {
        DETECTOR_BURST_WEIGHT: 0,
        DETECTOR_BINOCULARS_WEIGHT: 0,
        DETECTOR_STYLOMETRIC_WEIGHT: 0,
      },
      clients: {
        storage: {
          get: () => ok({ body: Buffer.from('\\documentclass{article}'), contentType: 'text/x-tex' }),
          put: () => ok(undefined),
        },
        compiler: {
          compile: () => ok({ pdf: Buffer.from('pdf') }),
        },
        latexml: {
          convertToHtml: () => ok({ html: Buffer.from('<html><body><p>ok</p></body></html>') }),
        },
        grobid: {
          extract: () =>
            ok({
              authors: [],
              references: [],
              bodyText: 'short metadata body',
            }),
        },
        keywords: {
          extract: () => ok([]),
        },
        detector: {
          score: () => ok({}),
        },
      },
      queues: {
        pdfFigures: { add: pdfFiguresAdd },
      },
      repos: {
        papers: {
          findById: () => ok({ ...paper, status }),
          latestVersion: () => ok(null),
          setStatus: (_id: string, next: string) => {
            status = next;
            return ok(undefined);
          },
          addVersion: () => ok(version),
          setHtmlKey: (_versionId: string, htmlKey: string) =>
            ok({
              ...version,
              htmlKey,
            }),
          setKeywords: () => ok(undefined),
          getDisclosure: () => ok({ level: 'assistant' }),
        },
        sagas: {
          ensure: () =>
            ok({
              paperId: paper.id,
              stagePaperPersisted,
              stagePaperApproved: false,
              stageIdAssigned: false,
              stagePdsPaper: false,
              stagePdsSummaryDisclosure: false,
              stageBlueskyBridge: false,
            }),
          markStageDone: (_paperId: string, stage: string) => {
            if (stage === 'stagePaperPersisted') stagePaperPersisted = true;
            return ok(undefined);
          },
          recordFailure: () => ok(undefined),
          get: () =>
            ok({
              paperId: paper.id,
              stagePaperPersisted,
              stagePaperApproved: false,
              stageIdAssigned: false,
              stagePdsPaper: false,
              stagePdsSummaryDisclosure: false,
              stageBlueskyBridge: false,
            }),
        },
        idAllocator: {},
      },
    } as unknown as AppContext;

    const result = await makeSubmissionsService(ctx).runSaga({
      paperId: paper.id,
      sourceKey: version.sourceKey,
      filename: 'paper.zip',
    });

    expect(result.isOk()).toBe(true);
    expect(pdfFiguresAdd).toHaveBeenCalledWith(
      'pdf-figures-after-compile',
      { paperId: paper.id, versionId: version.id },
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        jobId: `pdf-figures-${version.id}`,
      }),
    );
  });
});
