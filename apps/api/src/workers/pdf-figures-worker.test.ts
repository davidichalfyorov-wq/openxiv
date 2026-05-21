import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import { processPdfFiguresJob } from './pdf-figures-worker.js';

function ok<T>(value: T) {
  return ResultAsync.fromSafePromise(Promise.resolve(value));
}

describe('processPdfFiguresJob', () => {
  it('records a completed empty extraction for source submissions when source and PDF find no figures', async () => {
    const paperId = '00000000-0000-4000-8000-000000000001';
    const versionId = '00000000-0000-4000-8000-000000000002';
    const version = {
      id: versionId,
      paperId,
      versionNumber: 1,
      pdfKey: `papers/${paperId}/v1/paper.pdf`,
      sourceKey: `papers/${paperId}/v1/source-main.tex`,
      htmlKey: null,
      fileSha256: 'sha',
      sizeBytes: 128,
      pageCount: 1,
      publishedAt: null,
      createdAt: new Date('2026-05-19T00:00:00Z'),
    };
    const replaceForVersion = vi.fn(() => ok(0));
    const markExtractionComplete = vi.fn(() => ok(undefined));
    const extractor = {
      extractFigures: vi.fn(() => ok([])),
    };

    const ctx = {
      clients: {
        storage: {
          get: vi.fn((key: string) => {
            expect([version.sourceKey, version.pdfKey]).toContain(key);
            return ok({
              body:
                key === version.sourceKey
                  ? Buffer.from(String.raw`\section{No figures here} Plain text only.`)
                  : Buffer.from('%PDF-1.7'),
              contentType: key === version.sourceKey ? 'text/x-tex' : 'application/pdf',
            });
          }),
          put: vi.fn(() => ok(undefined)),
        },
      },
      repos: {
        papers: {
          loadWithRelations: vi.fn(() => ok({ latestVersion: version })),
          allVersions: vi.fn(() => ok([version])),
        },
        paperFigures: {
          extractionForVersion: vi.fn(() => ok(null)),
          forVersion: vi.fn(() => ok([])),
          replaceForVersion,
          markExtractionComplete,
        },
      },
      redis: {
        hincrby: vi.fn(() => Promise.resolve(0)),
      },
    } as unknown as AppContext;

    const result = await processPdfFiguresJob(ctx, { paperId, versionId }, { extractor });

    expect(result).toEqual({ count: 0, version: 1 });
    expect(extractor.extractFigures).toHaveBeenCalledOnce();
    expect(replaceForVersion).toHaveBeenCalledWith(paperId, 1, []);
    expect(markExtractionComplete).toHaveBeenCalledWith({
      paperId,
      version: 1,
      source: 'source_archive',
      reason: 'source_archive_no_figures',
      figureCount: 0,
    });
  });

  it('uses final-PDF crops when a source archive is present so inline TikZ figures are captured', async () => {
    const paperId = '00000000-0000-4000-8000-000000000011';
    const versionId = '00000000-0000-4000-8000-000000000012';
    const version = {
      id: versionId,
      paperId,
      versionNumber: 2,
      pdfKey: `papers/${paperId}/v2/paper.pdf`,
      sourceKey: `papers/${paperId}/v2/source-main.tex`,
      htmlKey: null,
      fileSha256: 'sha',
      sizeBytes: 128,
      pageCount: 3,
      publishedAt: null,
      createdAt: new Date('2026-05-19T00:00:00Z'),
    };
    const replaceForVersion = vi.fn(() => ok(0));
    const markExtractionComplete = vi.fn(() => ok(undefined));
    const extractor = {
      extractFigures: vi.fn(() =>
        ok([
          {
            idx: 0,
            page: 2,
            bbox: { p: 2, x: 70, y: 100, w: 420, h: 240 },
            caption: 'Figure 1: Inline TikZ structure.',
            type: 'figure' as const,
            png: Buffer.from('pdf-crop'),
          },
        ]),
      ),
    };

    const ctx = {
      clients: {
        storage: {
          get: vi.fn((key: string) =>
            ok({
              body:
                key === version.sourceKey
                  ? Buffer.from(String.raw`\includegraphics{chart.png}`)
                  : Buffer.from('%PDF-1.7'),
              contentType: key === version.sourceKey ? 'text/x-tex' : 'application/pdf',
            }),
          ),
          put: vi.fn(() => ok(undefined)),
        },
      },
      repos: {
        papers: {
          loadWithRelations: vi.fn(() => ok({ latestVersion: version })),
          allVersions: vi.fn(() => ok([version])),
        },
        paperFigures: {
          extractionForVersion: vi.fn(() => ok(null)),
          forVersion: vi.fn(() => ok([])),
          replaceForVersion,
          markExtractionComplete,
        },
      },
      redis: {
        hincrby: vi.fn(() => Promise.resolve(0)),
      },
    } as unknown as AppContext;

    const result = await processPdfFiguresJob(ctx, { paperId, versionId }, { extractor });

    expect(result).toEqual({ count: 1, version: 2 });
    expect(replaceForVersion).toHaveBeenCalledWith(
      paperId,
      2,
      expect.arrayContaining([
        expect.objectContaining({
          caption: 'Figure 1: Inline TikZ structure.',
          imageUrl: expect.stringContaining('/papers/00000000-0000-4000-8000-000000000011/v2-fig-0-'),
          page: 2,
          type: 'figure',
        }),
      ]),
    );
    expect(markExtractionComplete).toHaveBeenCalledWith({
      paperId,
      version: 2,
      source: 'pdf_grobid',
      reason: 'pdf_grobid_figures',
      figureCount: 1,
    });
  });
});
