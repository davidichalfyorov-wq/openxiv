import {
  Errors,
  type AppResultAsync,
  ResultAsync,
  fromPromise,
  randomToken,
  sha256Hex,
} from '@openxiv/shared';
import type { AppContext } from '../context.js';
import { extractToFileNodes } from './archive-extract.js';
import {
  detectEntryTex,
  extractTexMetadata,
  type TexMetadata,
} from './tex-detect.js';

const INTAKE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export interface IntakeInput {
  readonly bytes: Buffer;
  readonly filename: string;
}

export interface IntakeRecord {
  readonly sessionId: string;
  readonly filename: string;
  readonly sourceKey: string;
  readonly previewPdfKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly extractedTitle: string | null;
  readonly extractedAbstract: string | null;
  readonly extractedAuthors: Array<{ displayName: string; orcid?: string; affiliation?: string }>;
  readonly extractedReferences: string[];
  readonly extractedBodyText: string;
  readonly suggestedKeywords: string[];
  readonly grobidFailed: boolean;
  readonly createdAt: string;
}

export interface IntakeResult {
  readonly sessionId: string;
  readonly previewPdfUrl: string | null;
  readonly extractedTitle: string | null;
  readonly extractedAbstract: string | null;
  readonly extractedAuthors: Array<{ displayName: string; orcid?: string; affiliation?: string }>;
  readonly suggestedKeywords: string[];
  readonly grobidFailed: boolean;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly compileLogTail: string;
}

export interface IntakeService {
  intake(input: IntakeInput): AppResultAsync<IntakeResult>;
  getSession(sessionId: string): AppResultAsync<IntakeRecord | null>;
}

export function makeIntakeService(ctx: AppContext): IntakeService {
  const { storage, compiler, grobid, keywords, latexml } = ctx.clients;
  const { redis } = ctx;

  return {
    intake(input) {
      const sessionId = randomToken(16);
      const sourceKey = `intake/${sessionId}/source-${sanitizeFilename(input.filename)}`;
      const sha = sha256Hex(input.bytes);

      return ResultAsync.fromSafePromise(readTexMetadata(input)).andThen((texMeta) =>
          storage
            .put(sourceKey, input.bytes, { contentType: detectMime(input.filename) })
            .andThen(() =>
              compiler
                .compile({ source: input.bytes, filename: input.filename })
                .map((compiled) => ({ pdf: compiled.pdf, log: compiled.log, texMeta })),
            ),
        )
        .andThen(({ pdf, log, texMeta }) => {
          const previewPdfKey = `intake/${sessionId}/preview.pdf`;
          return storage
            .put(previewPdfKey, pdf, { contentType: 'application/pdf' })
            .map(() => ({ pdf, log, previewPdfKey, texMeta }));
        })
        .andThen(({ pdf, log, previewPdfKey, texMeta }) => {
          // GROBID is best-effort. If it fails we still let the user proceed
          // using explicit metadata from the TeX source.
          return grobid
            .extract(pdf)
            .map((meta) => ({
              pdf,
              log,
              previewPdfKey,
              texMeta,
              meta,
              grobidFailed: false,
            }))
            .orElse(() =>
              ResultAsync.fromSafePromise(
                Promise.resolve({
                  pdf,
                  log,
                  previewPdfKey,
                  texMeta,
                  meta: {
                    title: undefined,
                    abstract: undefined,
                    authors: [],
                    references: [],
                    bodyText: '',
                  },
                  grobidFailed: true,
                }),
              ),
            );
        })
        .andThen(({ pdf, log, previewPdfKey, meta, texMeta, grobidFailed }) => {
          const mergedMeta = mergeMetadata(meta, texMeta);
          const corpus = [mergedMeta.title ?? '', mergedMeta.abstract ?? '', mergedMeta.bodyText]
            .filter(Boolean)
            .join('\n\n');
          const explicitKeywords = texMeta.keywords;
          const keywordWork =
            corpus.length > 0
              ? keywords
                  .extract(corpus, { max: 10 })
                  .map((kws) => mergeKeywords(explicitKeywords, kws, 10))
              : ResultAsync.fromSafePromise(Promise.resolve(explicitKeywords.slice(0, 10)));
          return keywordWork.map((kws) => ({
            pdf,
            log,
            previewPdfKey,
            meta: mergedMeta,
            grobidFailed,
            kws,
          }));
        })
        .andThen(({ log, previewPdfKey, meta, grobidFailed, kws }) => {
          // Best-effort: also kick off LaTeXML now, but don't block — html is
          // produced again at the saga's compile stage. Skipping here keeps
          // intake responsive.
          void latexml;

          const record: IntakeRecord = {
            sessionId,
            filename: input.filename,
            sourceKey,
            previewPdfKey,
            sha256: sha,
            sizeBytes: input.bytes.length,
            extractedTitle: meta.title ?? null,
            extractedAbstract: meta.abstract ?? null,
            extractedAuthors: meta.authors,
            extractedReferences: meta.references,
            extractedBodyText: meta.bodyText.slice(0, 60_000),
            suggestedKeywords: kws,
            grobidFailed,
            createdAt: new Date().toISOString(),
          };
          return fromPromise(
            redis.set(`intake:${sessionId}`, JSON.stringify(record), 'EX', INTAKE_TTL_SECONDS),
            (cause) => Errors.internal('intake: redis stash failed', cause),
          ).map(() => ({ record, log }));
        })
        .andThen(({ record, log }) =>
          storage
            .presignGet(record.previewPdfKey, 3600)
            .map((url) => ({ record, log, url }))
            .orElse(() => ResultAsync.fromSafePromise(Promise.resolve({ record, log, url: '' }))),
        )
        .map(({ record, log, url }) => ({
          sessionId: record.sessionId,
          previewPdfUrl: url || null,
          extractedTitle: record.extractedTitle,
          extractedAbstract: record.extractedAbstract,
          extractedAuthors: record.extractedAuthors,
          suggestedKeywords: record.suggestedKeywords,
          grobidFailed: record.grobidFailed,
          sha256: record.sha256,
          sizeBytes: record.sizeBytes,
          compileLogTail: log.slice(-1000),
        }));
    },

    getSession(sessionId) {
      return fromPromise(redis.get(`intake:${sessionId}`), (cause) =>
        Errors.internal('intake: redis read failed', cause),
      ).map((raw) => (raw ? (JSON.parse(raw) as IntakeRecord) : null));
    },
  };
}

async function readTexMetadata(input: IntakeInput): Promise<TexMetadata> {
  try {
    const files = await extractToFileNodes(input.bytes, input.filename);
    const detected = detectEntryTex(files);
    if (detected.ok) return extractTexMetadata(detected.entry.content);
    if (/\.tex$/i.test(input.filename)) {
      return extractTexMetadata(input.bytes.toString('utf8'));
    }
  } catch {
    // Metadata fallback is non-terminal. The route pre-flight handles
    // malformed archives and missing documentclass before this service runs.
  }
  return { authors: [], keywords: [], bodyText: '' };
}

export function mergeMetadata(
  grobidMeta: {
    title?: string;
    abstract?: string;
    authors: Array<{ displayName: string; orcid?: string; affiliation?: string }>;
    references: string[];
    bodyText: string;
  },
  texMeta: TexMetadata,
): {
  title?: string;
  abstract?: string;
  authors: Array<{ displayName: string; orcid?: string; affiliation?: string }>;
  references: string[];
  bodyText: string;
} {
  const bodyText = grobidMeta.bodyText || texMeta.bodyText;
  return {
    ...(texMeta.title || grobidMeta.title ? { title: texMeta.title ?? grobidMeta.title } : {}),
    ...(texMeta.abstract || grobidMeta.abstract
      ? { abstract: texMeta.abstract ?? grobidMeta.abstract }
      : {}),
    authors: texMeta.authors.length > 0 ? texMeta.authors : grobidMeta.authors,
    references: grobidMeta.references,
    bodyText,
  };
}

function mergeKeywords(primary: string[], secondary: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...primary, ...secondary]) {
    const value = raw.trim().slice(0, 64);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

function detectMime(filename: string): string {
  if (/\.(tar\.gz|tgz)$/i.test(filename)) return 'application/gzip';
  if (/\.zip$/i.test(filename)) return 'application/zip';
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  return 'application/octet-stream';
}
