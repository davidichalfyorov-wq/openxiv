import {
  Errors,
  type AppResultAsync,
  ResultAsync,
  fromPromise,
  generateTid,
  parseAtUri,
  sha256Hex,
} from '@openxiv/shared';
import {
  PREPRINT_LEX_ID,
  disclosureRecordSchema,
  paperRecordSchema,
  preprintRecordSchema,
  summaryRecordSchema,
} from '@openxiv/lexicons';
import {
  SAGA_STAGE_ORDER,
  type PaperRecord,
  type PaperVersionRecord,
  type SagaRecord,
  type SagaStage,
} from '@openxiv/db';
import type { AppContext } from '../context.js';
import { makeBlueskyBridgeService } from './bluesky-bridge.js';
import { shouldHoldForManualModeration } from './moderation.js';
import { putAtProtoRecord } from './atproto-writer.js';
import { sanitizeOptionalPlainText, sanitizePlainText } from './sanitize.js';
import { extractFallbackMetadataFromSource } from './metadata-fallback.js';
import { paperCanonicalUrl, submitToIndexNow } from './indexnow.js';

export type SubmissionSummaryTier = 'school' | 'undergrad' | 'expert';

export interface SubmissionSummaryInput {
  readonly tier: SubmissionSummaryTier;
  readonly text: string;
  readonly aiGenerated: boolean;
  readonly aiModel?: string;
}

interface SummaryInputCarrier {
  readonly summaries?: readonly SubmissionSummaryInput[];
  readonly summaryText?: string;
  readonly summaryTier?: SubmissionSummaryTier;
  readonly summaryAiGenerated?: boolean;
}

export interface SubmitInput extends SummaryInputCarrier {
  readonly submitterDid: string;
  readonly title: string;
  readonly abstract?: string;
  readonly license: string;
  readonly primaryCategory: string;
  readonly secondaryCategories: string[];
  readonly authors: Array<{
    displayName: string;
    orcid?: string;
    affiliation?: string;
    did?: string;
    isCorresponding?: boolean;
  }>;
  readonly source: { bytes: Buffer; filename: string };
  readonly disclosure: {
    level: 'none' | 'assistant' | 'coauthor' | 'primary';
    aiUsed: string[];
    models: Array<{ name: string; vendor?: string; version?: string; usage?: string }>;
    notes?: string;
    summaryAiGenerated?: boolean;
    attestation: string;
  };
  readonly submissionTermsVersion: string;
}

export interface SubmitResult {
  readonly paperId: string;
  readonly status: 'compiling';
}

export interface SagaPayload {
  readonly paperId: string;
  readonly sourceKey: string;
  readonly filename: string;
  readonly retryCount?: number;
}

export interface HtmlCompilePayload {
  readonly paperId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly sourceKey: string;
  readonly filename: string;
  readonly requestedByDid?: string;
}

export interface HtmlCompileResult {
  readonly paperId: string;
  readonly versionId: string;
  readonly htmlKey: string;
}

export interface SagaResultSummary {
  readonly paperId: string;
  readonly openxivId: string | null;
  readonly stages: Record<SagaStage, boolean>;
  readonly status: PaperRecord['status'];
}

export function socialPushJobOptions(versionId: string) {
  return {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 60_000 },
    removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
    removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
    jobId: `mastodon-crosspost-${versionId}`,
  };
}

export function submissionSagaJobOptions(jobId: string) {
  return {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 60_000 },
    removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
    removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
    jobId,
  };
}

export function htmlCompileJobOptions(paperId: string, versionId: string) {
  return {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 60_000 },
    removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
    removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
    jobId: `html-${paperId}-${versionId}`,
  };
}

export interface FinalizeInput extends SummaryInputCarrier {
  readonly submitterDid: string;
  readonly sessionId: string;
  readonly title: string;
  readonly abstract: string;
  readonly license: string;
  readonly primaryCategory: string;
  readonly secondaryCategories: string[];
  readonly authors: Array<{
    displayName: string;
    orcid?: string;
    affiliation?: string;
    did?: string;
    isCorresponding?: boolean;
  }>;
  readonly keywords?: string[];
  readonly disclosure: {
    level: 'none' | 'assistant' | 'coauthor' | 'primary';
    aiUsed: string[];
    models: Array<{ name: string; vendor?: string; version?: string; usage?: string }>;
    notes?: string;
    summaryAiGenerated?: boolean;
    attestation: string;
  };
  readonly submissionTermsVersion: string;
}

export interface SubmissionsService {
  submitDraft(input: SubmitInput): AppResultAsync<SubmitResult>;
  finalizeFromIntake(input: FinalizeInput): AppResultAsync<SubmitResult>;
  runSaga(payload: SagaPayload): AppResultAsync<SagaResultSummary>;
  runHtmlCompile(payload: HtmlCompilePayload): AppResultAsync<HtmlCompileResult>;
  recompileHtml(
    paperId: string,
    opts?: { requestedByDid?: string },
  ): AppResultAsync<{ queued: true; jobId: string }>;
  retrySaga(paperId: string): AppResultAsync<void>;
}

export function makeSubmissionsService(ctx: AppContext): SubmissionsService {
  const { papers, sagas, idAllocator } = ctx.repos;
  const { storage } = ctx.clients;
  const { redis } = ctx;

  return {
    finalizeFromIntake(input) {
      return finalizeImpl(sanitizeFinalizeInput(input));
    },
    submitDraft(input) {
      const cleanInput = sanitizeSubmitInput(input);
      return validateInput(cleanInput)
        .andThen(() =>
          papers.create({
            submitterDid: cleanInput.submitterDid,
            title: cleanInput.title,
            abstract: cleanInput.abstract ?? null,
            license: cleanInput.license,
            primaryCategory: cleanInput.primaryCategory,
            status: 'compiling',
            submissionTermsVersion: cleanInput.submissionTermsVersion,
            submissionTermsAcceptedAt: new Date(),
          }),
        )
        .andThen((paper) =>
          papers
            .setCategories(paper.id, cleanInput.primaryCategory, cleanInput.secondaryCategories)
            .map(() => paper),
        )
        .andThen((paper) =>
          papers
            .setAuthors(
              paper.id,
              cleanInput.authors.map((a, i) => ({
                position: i,
                did: a.did ?? null,
                displayName: a.displayName,
                orcid: a.orcid ?? null,
                affiliation: a.affiliation ?? null,
                isCorresponding: a.isCorresponding ?? i === 0,
              })),
            )
            .map(() => paper),
        )
        .andThen((paper) => persistDisclosure(paper.id, cleanInput).map(() => paper))
        .andThen((paper) => persistSummaries(paper.id, cleanInput).map(() => paper))
        .andThen((paper) => {
          const safeName = sanitizeFilename(cleanInput.source.filename);
          const sourceKey = `papers/${paper.id}/v1/source-${safeName}`;
          return storage
            .put(sourceKey, cleanInput.source.bytes, { contentType: detectMime(safeName) })
            .andThen(() => sagas.ensure(paper.id))
            .map(() => ({ paper, sourceKey }));
        })
        .andThen(({ paper, sourceKey }) =>
          ResultAsync.fromPromise(
            ctx.queues.compile.add(
              'submit-saga',
              {
                paperId: paper.id,
                sourceKey,
                filename: cleanInput.source.filename,
              },
              submissionSagaJobOptions(`saga-${paper.id}`),
            ),
            (cause) => Errors.internal('enqueue saga job', cause),
          ).map(() => ({ paperId: paper.id, status: 'compiling' as const })),
        );
    },

    runSaga(payload) {
      const orchestrator = makeOrchestrator(ctx);
      return orchestrator.run(payload);
    },

    runHtmlCompile(payload) {
      return compileHtmlForExistingVersion(ctx, payload);
    },

    recompileHtml(paperId, opts = {}) {
      return papers.findById(paperId).andThen((paper) => {
        if (!paper) {
          return ResultAsync.fromPromise(Promise.reject(new Error('not found')), () =>
            Errors.notFound('paper'),
          );
        }
        return papers.latestVersion(paperId).andThen((version) => {
          if (!version?.sourceKey) {
            return ResultAsync.fromPromise(Promise.reject(new Error('missing source')), () =>
              Errors.conflict('paper version has no source archive to recompile'),
            );
          }
          const payload: HtmlCompilePayload = {
            paperId,
            versionId: version.id,
            versionNumber: version.versionNumber,
            sourceKey: version.sourceKey,
            filename: filenameFromSourceKey(version.sourceKey),
            ...(opts.requestedByDid ? { requestedByDid: opts.requestedByDid } : {}),
          };
          return fromPromise(
            ctx.queues.convertHtml.add(
              'recompile-html',
              payload,
              htmlCompileJobOptions(paperId, version.id),
            ),
            (cause) => Errors.internal('enqueue html recompile', cause),
          ).map((job) => ({
            queued: true as const,
            jobId: job.id ?? htmlCompileJobOptions(paperId, version.id).jobId,
          }));
        });
      });
    },

    retrySaga(paperId) {
      return papers.findById(paperId).andThen((paper) => {
        if (!paper) {
          return ResultAsync.fromPromise(Promise.reject(new Error('not found')), () =>
            Errors.notFound('paper'),
          );
        }
        // Find the source key from the first version (or skip if missing)
        return papers.latestVersion(paperId).andThen((version) => {
          const sourceKey = version?.sourceKey ?? `papers/${paper.id}/v1/source-main.tex`;
          const filename = filenameFromSourceKey(sourceKey);
          return ResultAsync.fromPromise(
            ctx.queues.compile.add(
              'submit-saga',
              { paperId, sourceKey, filename },
              submissionSagaJobOptions(`saga-${paperId}-retry-${Date.now()}`),
            ),
            (cause) => Errors.internal('retrySaga enqueue', cause),
          ).map(() => undefined);
        });
      });
    },
  };

  function finalizeImpl(input: FinalizeInput): AppResultAsync<SubmitResult> {
    return validateSubmissionMetadata(input)
      .andThen(() =>
        fromPromise(redis.get(`intake:${input.sessionId}`), (cause) =>
          Errors.internal('finalize: redis read', cause),
        ),
      )
      .andThen((raw) => {
        if (!raw) {
          return ResultAsync.fromPromise(Promise.reject(new Error('expired')), () =>
            Errors.notFound(`intake session ${input.sessionId} not found or expired`),
          );
        }
        const intake = JSON.parse(raw) as {
          sourceKey: string;
          previewPdfKey: string;
          filename: string;
          sha256: string;
          sizeBytes: number;
        };
        if (input.title.length < 4) {
          return ResultAsync.fromPromise(Promise.reject(new Error('short title')), () =>
            Errors.validation('title must be at least 4 chars'),
          );
        }
        if (input.disclosure.level !== 'none' && input.disclosure.aiUsed.length === 0) {
          return ResultAsync.fromPromise(Promise.reject(new Error('bad disclosure')), () =>
            Errors.validation('disclosure: aiUsed required for non-"none" level'),
          );
        }
        return papers
          .create({
            submitterDid: input.submitterDid,
            title: input.title,
            abstract: input.abstract || null,
            license: input.license,
            primaryCategory: input.primaryCategory,
            status: 'pending_review',
            submissionTermsVersion: input.submissionTermsVersion,
            submissionTermsAcceptedAt: new Date(),
          })
          .map((paper) => ({ paper, intake }));
      })
      .andThen(({ paper, intake }) =>
        papers
          .setCategories(paper.id, input.primaryCategory, input.secondaryCategories)
          .map(() => ({ paper, intake })),
      )
      .andThen(({ paper, intake }) =>
        papers
          .setAuthors(
            paper.id,
            input.authors.map((a, i) => ({
              position: i,
              did: a.did ?? null,
              displayName: a.displayName,
              orcid: a.orcid ?? null,
              affiliation: a.affiliation ?? null,
              isCorresponding: a.isCorresponding ?? i === 0,
            })),
          )
          .map(() => ({ paper, intake })),
      )
      .andThen(({ paper, intake }) => {
        if (input.keywords && input.keywords.length > 0) {
          return papers.setKeywords(paper.id, input.keywords).map(() => ({ paper, intake }));
        }
        return ResultAsync.fromSafePromise(Promise.resolve({ paper, intake }));
      })
      .andThen(({ paper, intake }) =>
        persistDisclosure(paper.id, input).map(() => ({ paper, intake })),
      )
      .andThen(({ paper, intake }) =>
        persistSummaries(paper.id, input).map(() => ({ paper, intake })),
      )
      .andThen(({ paper, intake }) => {
        // Move the intake source into the paper-scoped namespace. The saga
        // compiles from this source using the original filename so archives
        // keep their entrypoint/figure layout.
        const finalSourceKey = `papers/${paper.id}/v1/source-${sanitizeFilename(intake.filename)}`;
        return storage
          .get(intake.sourceKey)
          .andThen((sourceObj) =>
            storage
              .put(finalSourceKey, sourceObj.body, { contentType: sourceObj.contentType })
              .map(() => ({ paper, intake, finalSourceKey })),
          );
      })
      .andThen(({ paper, intake, finalSourceKey }) =>
        sagas.ensure(paper.id).map(() => ({ paper, intake, finalSourceKey })),
      )
      .andThen(({ paper, intake, finalSourceKey }) =>
        fromPromise(
          ctx.queues.compile.add(
            'submit-saga',
            { paperId: paper.id, sourceKey: finalSourceKey, filename: intake.filename },
            submissionSagaJobOptions(`saga-${paper.id}`),
          ),
          (cause) => Errors.internal('enqueue saga from finalize', cause),
        ).map(() => ({ paperId: paper.id, status: 'compiling' as const })),
      )
      .andThen((result) =>
        fromPromise(redis.del(`intake:${input.sessionId}`), () =>
          Errors.internal('redis del intake'),
        )
          .orElse(() => ResultAsync.fromSafePromise(Promise.resolve(0)))
          .map(() => result),
      );
  }

  void idAllocator;

  function persistDisclosure(
    paperId: string,
    input: SubmitInput | FinalizeInput,
  ): AppResultAsync<unknown> {
    const summaries = normalizeSubmissionSummaries(input);
    return papers.upsertDisclosure({
      paperId,
      level: input.disclosure.level,
      aiUsed: input.disclosure.aiUsed,
      models: input.disclosure.models,
      notes: input.disclosure.notes,
      summaryAiGenerated:
        input.disclosure.summaryAiGenerated ?? summaries.some((s) => s.aiGenerated),
      humanVerified: false,
      attestation: input.disclosure.attestation,
    });
  }

  function persistSummaries(
    paperId: string,
    input: SummaryInputCarrier,
  ): AppResultAsync<unknown[]> {
    return ResultAsync.combine(
      normalizeSubmissionSummaries(input).map((summary) =>
        papers.upsertSummary({
          paperId,
          tier: summary.tier,
          text: summary.text,
          aiGenerated: summary.aiGenerated,
          ...(summary.aiModel ? { aiModel: summary.aiModel } : {}),
        }),
      ),
    );
  }
}

function makeOrchestrator(ctx: AppContext): {
  run: (p: SagaPayload) => AppResultAsync<SagaResultSummary>;
} {
  const { papers, sagas, idAllocator } = ctx.repos;
  const { storage, compiler, grobid, keywords, detector } = ctx.clients;

  return {
    run(payload) {
      return sagas
        .ensure(payload.paperId)
        .andThen((saga) =>
          papers
            .findById(payload.paperId)
            .andThen((paper) =>
              paper
                ? ResultAsync.fromSafePromise(Promise.resolve({ saga, paper }))
                : ResultAsync.fromPromise(Promise.reject(new Error('gone')), () =>
                    Errors.notFound(`paper ${payload.paperId}`),
                  ),
            ),
        )
        .andThen(({ saga, paper }) => runAllStages(saga, paper))
        .andThen((paper) => buildSummary(paper.id));

      function runAllStages(
        saga: SagaRecord,
        initialPaper: PaperRecord,
      ): AppResultAsync<PaperRecord> {
        return runStages(saga, initialPaper, 0);
      }

      function runStages(
        saga: SagaRecord,
        paper: PaperRecord,
        idx: number,
      ): AppResultAsync<PaperRecord> {
        if (idx >= SAGA_STAGE_ORDER.length) {
          return ResultAsync.fromSafePromise(Promise.resolve(paper));
        }
        const stage = SAGA_STAGE_ORDER[idx]!;
        if (saga[stage]) {
          // Already done; advance.
          return runStages(saga, paper, idx + 1);
        }
        if (shouldHoldForManualModeration(stage, Boolean(saga[stage]))) {
          return papers.setStatus(paper.id, 'pending_review').andThen(() => requirePaper(paper.id));
        }
        return runStage(stage, paper)
          .andThen((updatedPaper) =>
            sagas.markStageDone(payload.paperId, stage).map(() => updatedPaper),
          )
          .andThen((updatedPaper) =>
            sagas
              .ensure(payload.paperId)
              .andThen((nextSaga) => runStages(nextSaga, updatedPaper, idx + 1)),
          )
          .orElse((err) =>
            sagas
              .recordFailure(
                payload.paperId,
                stage,
                formatSagaStageError(payload.paperId, stage, err, payload.retryCount ?? 0),
              )
              .andThen(() => ResultAsync.fromPromise(Promise.reject(err), () => err)),
          );
      }

      function runStage(stage: SagaStage, paper: PaperRecord): AppResultAsync<PaperRecord> {
        switch (stage) {
          case 'stagePaperPersisted':
            return runCompile(paper);
          case 'stagePaperApproved':
            // This branch is reached only after a moderator/admin has
            // marked the approval stage complete. Without that, runStages
            // returns early and leaves the paper in pending_review.
            return papers
              .setStatus(paper.id, 'pending_review')
              .andThen(() => requirePaper(paper.id));
          case 'stageIdAssigned':
            return runAssignId(paper);
          case 'stagePdsPaper':
            return runPublishPaperRecord(paper);
          case 'stagePdsSummaryDisclosure':
            return runPublishSummaryAndDisclosure(paper).andThen((p) =>
              indexSectionsBestEffort(p).map(() => p),
            );
          case 'stageBlueskyBridge':
            return runBlueskyBridge(paper);
        }
      }

      function runCompile(paper: PaperRecord): AppResultAsync<PaperRecord> {
        return storage
          .get(payload.sourceKey)
          .andThen((obj) => {
            const source = obj.body;
            const sha = sha256Hex(source);
            return ensureVersionWithPdf(source, sha);
          })
          .andThen(({ source, version, pdf }) =>
            ensureVersionHtml(version, source).map((updatedVersion) => ({
              source,
              version: updatedVersion,
              pdf,
            })),
          )
          .andThen(({ source, version, pdf }) =>
            enqueuePdfFiguresAfterCompile(paper.id, version.id).map(() => ({ pdf, source })),
          )
          .andThen(({ pdf, source }) =>
            grobid
              .extract(pdf)
              .map((meta) => ({ meta }))
              .orElse(() =>
                ResultAsync.fromSafePromise(
                  extractFallbackMetadataFromSource(source, payload.filename).then((meta) => ({ meta })),
                ),
              ),
          )
          .andThen(({ meta }) => {
            const corpus = [paper.title, paper.abstract ?? '', meta.bodyText]
              .filter(Boolean)
              .join('\n\n');
            return keywords.extract(corpus, { max: 12 }).map((kws) => ({ meta, kws }));
          })
          .andThen(({ meta, kws }) => papers.setKeywords(paper.id, kws).map(() => meta))
          .andThen((meta) => maybeRunDetector(paper.id, meta.bodyText))
          .andThen(() => requirePaper(paper.id));

        function ensureVersionWithPdf(
          source: Buffer,
          sha: string,
        ): AppResultAsync<{ source: Buffer; version: PaperVersionRecord; pdf: Buffer }> {
          return papers.latestVersion(paper.id).andThen((existing) => {
            if (existing?.sourceKey === payload.sourceKey && existing.pdfKey) {
              return storage
                .get(existing.pdfKey)
                .map((obj) => ({ source, version: existing, pdf: obj.body }))
                .orElse(() => compileAndPersistPdf(source, sha, existing));
            }
            return compileAndPersistPdf(source, sha, null);
          });
        }

        function compileAndPersistPdf(
          source: Buffer,
          sha: string,
          existing: PaperVersionRecord | null,
        ): AppResultAsync<{ source: Buffer; version: PaperVersionRecord; pdf: Buffer }> {
          const versionNumber = existing?.versionNumber ?? 1;
          const pdfKey = existing?.pdfKey ?? `papers/${paper.id}/v${versionNumber}/paper.pdf`;
          return compiler
            .compile({ source, filename: payload.filename })
            .andThen((compiled) =>
              storage
                .put(pdfKey, compiled.pdf, { contentType: 'application/pdf' })
                .map(() => ({ compiled, pdfKey })),
            )
            .andThen(({ compiled }) => {
              if (existing) {
                return ResultAsync.fromSafePromise(
                  Promise.resolve({ source, version: existing, pdf: compiled.pdf }),
                );
              }
              return papers
                .addVersion({
                  paperId: paper.id,
                  versionNumber,
                  pdfKey,
                  sourceKey: payload.sourceKey,
                  fileSha256: sha,
                  sizeBytes: compiled.pdf.length,
                  pageCount: null,
                  publishedAt: null,
                })
                .map((version) => ({ source, version, pdf: compiled.pdf }));
            });
        }

        function ensureVersionHtml(version: PaperVersionRecord, source: Buffer) {
          if (version.htmlKey) return ResultAsync.fromSafePromise(Promise.resolve(version));
          return convertSourceToHtml(ctx, {
            paperId: paper.id,
            versionNumber: version.versionNumber,
            source,
            filename: payload.filename,
          }).andThen(({ htmlKey }) => papers.setHtmlKey(version.id, htmlKey));
        }
      }

      function runAssignId(paper: PaperRecord): AppResultAsync<PaperRecord> {
        if (paper.openxivId) {
          return ResultAsync.fromSafePromise(Promise.resolve(paper));
        }
        // Year is pinned to paper.createdAt to avoid the year-boundary race
        // (paper submitted 23:59 Dec 31, id assigned 00:00 Jan 1 next year).
        const year = new Date(paper.createdAt).getUTCFullYear();
        return idAllocator
          .allocateAndClaim(paper.id, paper.primaryCategory, year)
          .andThen(() => requirePaper(paper.id));
      }

      function runPublishPaperRecord(paper: PaperRecord): AppResultAsync<PaperRecord> {
        if (paper.uri) {
          return ResultAsync.fromSafePromise(Promise.resolve(paper));
        }
        return papers.loadWithRelations(paper.id).andThen((loaded) => {
          if (!loaded) {
            return ResultAsync.fromPromise(Promise.reject(new Error('gone')), () =>
              Errors.notFound('paper'),
            );
          }
          const record = {
            title: loaded.paper.title,
            authors: loaded.authors.map((a) => ({
              displayName: a.displayName,
              did: a.did ?? undefined,
              orcid: a.orcid ?? undefined,
              affiliation: a.affiliation ?? undefined,
              isCorresponding: a.isCorresponding,
            })),
            categories: loaded.categories,
            primaryCategory: loaded.paper.primaryCategory,
            crossListings: loaded.paper.crossListings ?? [],
            abstract: loaded.paper.abstract ?? undefined,
            keywords: loaded.keywords,
            license: loaded.paper.license,
            createdAt: loaded.paper.createdAt.toISOString(),
          };
          const validated = paperRecordSchema.safeParse(record);
          if (!validated.success) {
            return ResultAsync.fromPromise(Promise.reject(new Error('lex bad')), () =>
              Errors.validation('paper lexicon', validated.error.issues),
            );
          }
          return putAtProtoRecord(ctx, {
            repo: loaded.paper.submitterDid,
            collection: 'app.openxiv.paper',
            rkey: generateTid(),
            record: validated.data as Record<string, unknown>,
          })
            .andThen((written) => {
              const parts = parseAtUri(written.uri);
              const preprintRecord = buildPreprintCompatibilityRecord(
                validated.data as Record<string, unknown>,
              );
              const preprintValid = preprintRecordSchema.safeParse(preprintRecord);
              const aliasWrite =
                parts && preprintValid.success
                  ? putAtProtoRecord(ctx, {
                      repo: loaded.paper.submitterDid,
                      collection: PREPRINT_LEX_ID,
                      rkey: parts.rkey,
                      record: preprintValid.data as Record<string, unknown>,
                    }).orElse((err) => {
                      console.warn(
                        '[saga] pds preprint compatibility write failed; continuing with paper record:',
                        err?.message ?? err,
                      );
                      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
                    })
                  : ResultAsync.fromSafePromise(Promise.resolve(undefined));
              return aliasWrite.andThen(() =>
                papers
                  .setUri(loaded.paper.id, written.uri, written.cid)
                  .andThen(() => papers.setStatus(loaded.paper.id, 'published'))
                  .andThen(() => requirePaper(loaded.paper.id)),
              );
            })
            .orElse((err) => {
              console.warn(
                '[saga] pds paper write failed; publishing locally:',
                err?.message ?? err,
              );
              const localPublish = papers
                .setStatus(loaded.paper.id, 'published')
                .andThen(() => requirePaper(loaded.paper.id));
              if (!loaded.paper.submitterDid.startsWith('did:plc:')) {
                return localPublish;
              }
              return localPublish
                .andThen(() => enqueuePostPublishJobs(loaded.paper.id))
                .andThen(() =>
                  ResultAsync.fromPromise(Promise.reject(new Error(err.message)), () => err),
                );
            });
        });
      }

      function runPublishSummaryAndDisclosure(paper: PaperRecord): AppResultAsync<PaperRecord> {
        return papers.loadWithRelations(paper.id).andThen((loaded) => {
          if (!loaded) {
            return ResultAsync.fromPromise(
              Promise.reject(new Error('paper not published yet')),
              () => Errors.notFound('paper'),
            );
          }
          if (!loaded.paper.uri) {
            return requirePaper(paper.id);
          }
          const tasks: AppResultAsync<unknown>[] = [];
          for (const s of loaded.summaries) {
            const record = {
              paperUri: loaded.paper.uri,
              tier: s.tier,
              text: s.text,
              aiGenerated: s.aiGenerated,
              ...(s.aiModel ? { aiModel: s.aiModel } : {}),
              createdAt: s.createdAt.toISOString(),
            };
            if (!summaryRecordSchema.safeParse(record).success) continue;
            tasks.push(
              putAtProtoRecord(ctx, {
                repo: loaded.paper.submitterDid,
                collection: 'app.openxiv.summary',
                rkey: generateTid(),
                record,
              }),
            );
          }
          if (loaded.disclosure) {
            const d = loaded.disclosure;
            const record = {
              paperUri: loaded.paper.uri,
              level: d.level,
              aiUsed: d.aiUsed,
              models: d.models,
              ...(d.notes ? { notes: d.notes } : {}),
              summaryAiGenerated: d.summaryAiGenerated,
              humanVerified: d.humanVerified,
              attestation: d.attestation as 'i-attest-this-disclosure-is-accurate',
              createdAt: d.createdAt.toISOString(),
            };
            if (disclosureRecordSchema.safeParse(record).success) {
              tasks.push(
                putAtProtoRecord(ctx, {
                  repo: loaded.paper.submitterDid,
                  collection: 'app.openxiv.disclosure',
                  rkey: generateTid(),
                  record,
                }),
              );
            }
          }
          return ResultAsync.combine(tasks)
            .orElse((err) => {
              console.warn(
                '[saga] pds summary/disclosure write failed; continuing locally:',
                err?.message ?? err,
              );
              return ResultAsync.fromSafePromise(Promise.resolve([] as unknown[]));
            })
            .andThen(() => requirePaper(paper.id));
        });
      }

      function indexSectionsBestEffort(paper: PaperRecord): AppResultAsync<void> {
        // Build a searchable corpus, preferring real body text over a
        // metadata-only stub. Order of preference:
        //   1. LaTeXML/pandoc HTML output from the compile worker — body
        //      sections, the real prose. Stripped to plain text with
        //      paragraph + heading structure preserved.
        //   2. Title + abstract + summaries + keywords — metadata fallback
        //      so a paper with a failed HTML conversion is still indexed.
        // Failure must not abort the saga; we always return Ok.
        return papers
          .loadWithRelations(paper.id)
          .andThen((loaded) => {
            if (!loaded) return ResultAsync.fromSafePromise(Promise.resolve(undefined));

            const metaText = [
              loaded.paper.title,
              loaded.paper.abstract ?? '',
              ...loaded.summaries.map((s) => s.text),
              ...loaded.keywords,
            ]
              .filter(Boolean)
              .join('\n\n');

            const fetchBody = async (): Promise<string> => {
              const htmlKey = loaded.latestVersion?.htmlKey;
              if (!htmlKey) return '';
              try {
                const obj = await storage.get(htmlKey);
                if (obj.isErr()) return '';
                const { htmlToText } = await import('./html-to-text.js');
                const body = htmlToText(obj.value.body.toString('utf8'));
                return body.length >= 200 ? body : '';
              } catch {
                return '';
              }
            };

            return ResultAsync.fromPromise(
              (async () => {
                const body = await fetchBody();
                // Combine: title + abstract as the leading "preamble" + real
                // body text. The chunker emits the preamble as section 0 and
                // body sections after.
                const text = body
                  ? `${loaded.paper.title}\n\n${loaded.paper.abstract ?? ''}\n\n${body}`.trim()
                  : metaText;
                if (text.length < 80) return undefined;
                const { makeSectionsIndexer } = await import('./sections.js');
                await makeSectionsIndexer(ctx)
                  .reindex({ paperId: paper.id, text, title: loaded.paper.title })
                  .match(
                    () => undefined,
                    () => undefined,
                  );
                return undefined;
              })(),
              () => Errors.internal('sections indexer crashed'),
            ).map(() => undefined);
          })
          .orElse(() => ResultAsync.fromSafePromise(Promise.resolve(undefined)));
      }

      function runBlueskyBridge(paper: PaperRecord): AppResultAsync<PaperRecord> {
        return papers.latestVersion(paper.id).andThen((version) => {
          if (!version) {
            // No version row yet — extremely unusual; treat as transient and
            // skip rather than fail the saga.
            return ResultAsync.fromSafePromise(Promise.resolve(paper));
          }
          // No paper.uri means the AT-proto write stage didn't complete; the
          // bridge is meaningless without a paperUri to embed. Final PDF
          // generation still must run for the local public page.
          if (!paper.uri) {
            return enqueuePdfFinalize(paper.id, version.id)
              .andThen(() => enqueueSocialPushes(paper.id, version.id))
              .andThen(() => requirePaper(paper.id));
          }
          // The bridge runs through a dedicated service that handles
          // idempotency, feature flag, threading, embed, and failure
          // isolation. The saga doesn't care about the outcome — bridging
          // failure is logged on paper_versions but the version is still
          // considered "published" on AT-proto.
          const bridge = makeBlueskyBridgeService(ctx, { publicBase: ctx.env.PUBLIC_WEB_BASE });
          return bridge
            .bridgeVersion({ paper, version })
            .orElse((err) =>
              ResultAsync.fromSafePromise(
                Promise.resolve({
                  uri: null,
                  cid: null,
                  status: 'failed' as const,
                  error: err.message,
                }),
              ),
            )
            .andThen((bridgeResult) =>
              enqueuePdfFinalize(paper.id, version.id)
                .andThen(() => enqueueSocialPushes(paper.id, version.id))
                .andThen(() => {
                  if (bridgeResult.status === 'failed') {
                    console.warn(
                      '[saga] Bluesky bridge failed non-fatally:',
                      'error' in bridgeResult ? bridgeResult.error : 'unknown error',
                    );
                  }
                  return ResultAsync.fromSafePromise(Promise.resolve(undefined));
                }),
            )
            .andThen(() => requirePaper(paper.id));
        });
      }

      function enqueuePostPublishJobs(paperId: string): AppResultAsync<void> {
        return papers.latestVersion(paperId).andThen((version) => {
          if (!version) return ResultAsync.fromSafePromise(Promise.resolve(undefined));
          return enqueuePdfFinalize(paperId, version.id).andThen(() =>
            enqueueSocialPushes(paperId, version.id),
          );
        });
      }

      function enqueuePdfFinalize(paperId: string, versionId: string): AppResultAsync<void> {
        return fromPromise(
          ctx.queues.pdfFinalize.add(
            'pdf-finalize-after-submit',
            { paperId, versionId },
            {
              attempts: 5,
              backoff: { type: 'exponential', delay: 60_000 },
              removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
              removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
              jobId: `pdf-finalize-${versionId}`,
            },
          ),
          (cause) => Errors.internal('enqueue pdf-finalize after submit', cause),
        ).map(() => undefined);
      }

      function enqueuePdfFiguresAfterCompile(
        paperId: string,
        versionId: string,
      ): AppResultAsync<void> {
        return ResultAsync.fromSafePromise(
          ctx.queues.pdfFigures
            .add(
              'pdf-figures-after-compile',
              { paperId, versionId },
              {
                attempts: 5,
                backoff: { type: 'exponential', delay: 60_000 },
                removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
                removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
                jobId: `pdf-figures-${versionId}`,
              },
            )
            .catch((e: unknown) => {
              console.warn(
                '[saga] failed to enqueue pdf-figures after compile:',
                (e as Error)?.message ?? e,
              );
              return undefined;
            }),
        ).map(() => undefined);
      }

      function enqueueSocialPushes(paperId: string, versionId: string): AppResultAsync<void> {
        // Fire-and-forget IndexNow ping (Bing + Yandex push-indexing).
        // Best-effort signaling — failures are swallowed inside
        // submitToIndexNow and the saga never observes the outcome. We fire
        // it from here rather than from a dedicated worker so the ping
        // tracks the publish moment, not a downstream queue's lag.
        void (async () => {
          const paperResult = await papers.findById(paperId);
          if (paperResult.isErr() || !paperResult.value) return;
          const paper = paperResult.value;
          await submitToIndexNow(ctx, [
            paperCanonicalUrl(ctx.env.PUBLIC_WEB_BASE, paper.openxivId, paper.id),
          ]);
        })();
        return fromPromise(
          ctx.queues.mastodonCrosspost.add(
            'mastodon-crosspost-after-submit',
            { paperId },
            socialPushJobOptions(versionId),
          ),
          (cause) => Errors.internal('enqueue social push after submit', cause),
        ).map(() => undefined);
      }

      function maybeRunDetector(paperId: string, bodyText: string): AppResultAsync<void> {
        return papers.getDisclosure(paperId).andThen((disclosure) => {
          if (!disclosure || disclosure.level !== 'none' || bodyText.length < 200) {
            return ResultAsync.fromSafePromise(Promise.resolve(undefined));
          }
          return detector
            .score(bodyText, {
              burst: ctx.env.DETECTOR_BURST_WEIGHT,
              binoculars: ctx.env.DETECTOR_BINOCULARS_WEIGHT,
              stylometric: ctx.env.DETECTOR_STYLOMETRIC_WEIGHT,
            })
            .map(() => undefined);
        });
      }

      function requirePaper(paperId: string): AppResultAsync<PaperRecord> {
        return papers
          .findById(paperId)
          .andThen((paper) =>
            paper
              ? ResultAsync.fromSafePromise(Promise.resolve(paper))
              : ResultAsync.fromPromise(Promise.reject(new Error('gone')), () =>
                  Errors.internal(`paper ${paperId} vanished mid-saga`),
              ),
          );
      }

      function buildSummary(paperId: string): AppResultAsync<SagaResultSummary> {
        return ResultAsync.combine([papers.findById(paperId), sagas.get(paperId)]).map(
          ([paper, saga]) => {
            const stages = Object.fromEntries(
              SAGA_STAGE_ORDER.map((s) => [s, saga ? Boolean(saga[s]) : false]),
            ) as Record<SagaStage, boolean>;
            return {
              paperId,
              openxivId: paper?.openxivId ?? null,
              stages,
              status: paper?.status ?? 'draft',
            };
          },
        );
      }
    },
  };
}

function convertSourceToHtml(
  ctx: AppContext,
  input: {
    paperId: string;
    versionNumber: number;
    source: Buffer;
    filename: string;
  },
): AppResultAsync<{ htmlKey: string }> {
  const htmlKey = `papers/${input.paperId}/v${input.versionNumber}/paper.html`;
  return ctx.clients.latexml
    .convertToHtml({ source: input.source, filename: input.filename })
    .andThen((html) => {
      if (!html.html || html.html.length === 0) {
        return ResultAsync.fromPromise(Promise.reject(new Error('empty html')), () =>
          Errors.externalInvalidResponse('latexml produced empty html'),
        );
      }
      return ctx.clients.storage
        .put(htmlKey, html.html, { contentType: 'text/html; charset=utf-8' })
        .map(() => ({ htmlKey }));
    });
}

function compileHtmlForExistingVersion(
  ctx: AppContext,
  payload: HtmlCompilePayload,
): AppResultAsync<HtmlCompileResult> {
  return ctx.clients.storage
    .get(payload.sourceKey)
    .andThen((obj) =>
      convertSourceToHtml(ctx, {
        paperId: payload.paperId,
        versionNumber: payload.versionNumber,
        source: obj.body,
        filename: payload.filename,
      }),
    )
    .andThen(({ htmlKey }) =>
      ctx.repos.papers
        .setHtmlKey(payload.versionId, htmlKey)
        .map(() => ({ paperId: payload.paperId, versionId: payload.versionId, htmlKey })),
    );
}

function formatSagaStageError(
  paperId: string,
  stage: SagaStage,
  err: Error,
  retryCount: number,
): string {
  return JSON.stringify({
    paper_id: paperId,
    stage,
    error: err.message,
    retry_count: retryCount,
  });
}

function sanitizeAuthors<T extends { displayName: string; affiliation?: string }>(
  authors: readonly T[],
): T[] {
  return authors.map((author) => ({
    ...author,
    displayName: sanitizePlainText(author.displayName) || 'Unknown author',
    ...(author.affiliation !== undefined
      ? { affiliation: sanitizeOptionalPlainText(author.affiliation) ?? undefined }
      : {}),
  }));
}

function sanitizeSubmitInput(input: SubmitInput): SubmitInput {
  const abstract = sanitizeOptionalPlainText(input.abstract);
  const { abstract: _abstract, ...rest } = input;
  return {
    ...rest,
    title: sanitizePlainText(input.title),
    ...(abstract !== null ? { abstract } : {}),
    authors: sanitizeAuthors(input.authors),
  };
}

function sanitizeFinalizeInput(input: FinalizeInput): FinalizeInput {
  return {
    ...input,
    title: sanitizePlainText(input.title),
    abstract: sanitizePlainText(input.abstract),
    authors: sanitizeAuthors(input.authors),
  };
}

function detectMime(filename: string): string {
  if (/\.(tar\.gz|tgz)$/i.test(filename)) return 'application/gzip';
  if (/\.zip$/i.test(filename)) return 'application/zip';
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  return 'application/octet-stream';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

export function filenameFromSourceKey(sourceKey?: string | null): string {
  const leaf = sourceKey?.split('/').pop();
  if (!leaf) return 'main.tex';
  return leaf.startsWith('source-') && leaf.length > 'source-'.length
    ? leaf.slice('source-'.length)
    : 'main.tex';
}

export function buildPreprintCompatibilityRecord(
  paperRecord: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...paperRecord,
    $type: PREPRINT_LEX_ID,
  };
}

void detectMime;

export function normalizeSubmissionSummaries(
  input: SummaryInputCarrier,
): SubmissionSummaryInput[] {
  const raw =
    input.summaries && input.summaries.length > 0
      ? input.summaries
      : input.summaryText !== undefined
        ? [
            {
              tier: input.summaryTier ?? 'undergrad',
              text: input.summaryText,
              aiGenerated: input.summaryAiGenerated ?? false,
            },
          ]
        : [];

  return raw.map((summary) => ({
    tier: summary.tier,
    text: summary.text.trim(),
    aiGenerated: summary.aiGenerated,
    ...(summary.aiModel ? { aiModel: summary.aiModel } : {}),
  }));
}

function validation(message: string): AppResultAsync<never> {
  return ResultAsync.fromPromise(Promise.reject(new Error(message)), () =>
    Errors.validation(message),
  );
}

function validateSubmissionMetadata(
  input: Pick<SubmitInput, 'title' | 'disclosure'> & SummaryInputCarrier,
): AppResultAsync<void> {
  if (input.title.length < 4) {
    return validation('title must be at least 4 chars');
  }
  if (input.disclosure.level !== 'none' && input.disclosure.aiUsed.length === 0) {
    return validation('disclosure: aiUsed required for non-"none" level');
  }

  const summaries = normalizeSubmissionSummaries(input);
  if (summaries.length === 0) {
    return validation('at least one plain-language summary is required');
  }
  if (summaries.length > 3) {
    return validation('at most one summary per explainer tier is allowed');
  }
  const seen = new Set<SubmissionSummaryTier>();
  for (const summary of summaries) {
    if (seen.has(summary.tier)) {
      return validation(`duplicate summary tier: ${summary.tier}`);
    }
    seen.add(summary.tier);
    if (summary.text.length < 80 || summary.text.length > 4000) {
      return validation(`summary ${summary.tier} must be 80-4000 chars`);
    }
  }

  const generated = summaries.filter((s) => s.aiGenerated);
  if (generated.length > 0) {
    if (input.disclosure.level === 'none') {
      return validation('AI-generated summaries require an AI disclosure level');
    }
    if (!input.disclosure.aiUsed.includes('summary')) {
      return validation('AI-generated summaries require disclosure aiUsed=summary');
    }
    if (
      input.disclosure.models.length === 0 &&
      generated.every((summary) => !summary.aiModel)
    ) {
      return validation('AI-generated summaries require a model name');
    }
  }

  return ResultAsync.fromSafePromise(Promise.resolve(undefined));
}

function validateInput(input: SubmitInput): AppResultAsync<void> {
  if (!input.source.bytes.length) {
    return ResultAsync.fromPromise(Promise.reject(new Error('empty')), () =>
      Errors.validation('source file is empty'),
    );
  }
  if (input.source.bytes.length > 100 * 1024 * 1024) {
    return ResultAsync.fromPromise(Promise.reject(new Error('too large')), () =>
      Errors.validation('source exceeds 100MB'),
    );
  }
  return validateSubmissionMetadata(input);
}
