import {
  Errors,
  type AppResultAsync,
  ResultAsync,
  TOKEN_LIMITS,
  estimateTokens,
} from '@openxiv/shared';
import type { AppContext } from '../context.js';

/**
 * Hard cap on tokens per embedding request. gemini-embedding-001 (the model
 * we use after Google deprecated text-embedding-004) accepts at most 2048
 * input tokens. We split at 1800 so headroom + tokenizer drift cannot push
 * a single chunk over the wire limit.
 */
const MAX_TOKENS_PER_SECTION = TOKEN_LIMITS.geminiEmbeddingSafe;

/** Aim for ~700 tokens per section so a typical paper produces 8–20 chunks. */
const SECTION_TARGET_TOKENS = 700;

/** Sections shorter than this merge with the previous one. */
const SECTION_MIN_TOKENS = 80;

/**
 * Hard upper bound on sections per paper. Protects the embedding budget
 * from a pathological 1000-section paper that would burn 1000 LLM calls.
 * The indexer refuses to run beyond this.
 */
export const MAX_SECTIONS_PER_PAPER = 80;

/**
 * Recognise common heading patterns the way GROBID and pandoc emit them:
 *   - Markdown:   `# Title`, `## Title`
 *   - Numbered:   `1. Title`, `1.1 Title`, `2.3.4 Title`
 *   - Roman:      `I. Title`, `IV. Title`
 *   - ALL CAPS short lines (≤ 8 words) — common in tex output
 */
const HEADING_REGEX =
  /^\s{0,3}(#{1,6}\s.+|[0-9]+(?:\.[0-9]+){0,4}\s+\S.+|[IVXLCDM]+\.\s+\S.+|[A-Z][A-Z0-9 \-:]{2,80})$/;
const REFERENCE_HEADING_REGEX =
  /^(?:#{1,6}\s*)?(?:\d+(?:\.\d+)*\.?\s+)?(?:references|bibliography|works cited|literature cited)\s*[:.]?$/i;

export interface ChunkInput {
  readonly title?: string;
  readonly text: string;
}

export interface SectionChunk {
  readonly sectionIdx: number;
  readonly title: string | null;
  readonly anchor: string | null;
  readonly content: string;
  readonly tokensEstimated: number;
}

/**
 * Token-aware section chunker. Splits on heading-shaped lines first, then
 * sub-splits oversized sections at paragraph / sentence boundaries so no
 * single chunk exceeds MAX_TOKENS_PER_SECTION. Output is capped to
 * MAX_SECTIONS_PER_PAPER chunks.
 *
 * Properties (guaranteed):
 *   - For every chunk c: estimateTokens(c.content) <= MAX_TOKENS_PER_SECTION.
 *   - Chunks preserve original text order; sectionIdx is monotonic 0..N-1.
 *   - Anchors are slug-safe and stable for the same heading text.
 *   - Empty input → []. Tiny input → exactly one chunk.
 */
export function chunkSections(input: ChunkInput): SectionChunk[] {
  if (typeof input.text !== 'string' || input.text.trim().length === 0) return [];

  const lines = input.text.split(/\r?\n/);
  const blocks: Array<{ heading: string | null; body: string[] }> = [];
  let current: { heading: string | null; body: string[] } = { heading: null, body: [] };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      line.length >= 2 &&
      (isReferenceHeading(line) || HEADING_REGEX.test(line)) &&
      line.length <= 200
    ) {
      if (current.body.length > 0 || current.heading) blocks.push(current);
      current = { heading: line.replace(/^#+\s*/, '').slice(0, 200), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length > 0 || current.heading) blocks.push(current);

  // Merge consecutive small blocks; split oversized blocks. Decisions are
  // based on token estimate, not raw char length, so non-ASCII text gets
  // the same treatment as ASCII.
  const merged: Array<{ heading: string | null; content: string; tokens: number }> = [];
  let buffer: { heading: string | null; content: string; tokens: number } | null = null;
  for (const block of blocks) {
    const content = block.body.join('\n').trim();
    if (!content) continue;
    const tokens = estimateTokens(content);
    const keepSeparate =
      isReferenceHeading(block.heading) || isReferenceHeading(buffer?.heading ?? null);
    if (
      buffer &&
      !keepSeparate &&
      buffer.tokens + tokens < SECTION_TARGET_TOKENS &&
      buffer.tokens + tokens < MAX_TOKENS_PER_SECTION
    ) {
      buffer.content = `${buffer.content}\n\n${content}`;
      buffer.tokens += tokens;
    } else {
      if (buffer) merged.push(buffer);
      buffer = { heading: block.heading, content, tokens };
    }
  }
  if (buffer) merged.push(buffer);

  const out: SectionChunk[] = [];
  for (const m of merged) {
    if (out.length >= MAX_SECTIONS_PER_PAPER) break;
    // Re-estimate against the actually-joined content. Per-block tokens
    // were summed at merge time, which can drift up to a few % below the
    // estimate of the concatenation. We always trust the post-merge value.
    const actualTokens = estimateTokens(m.content);
    if (actualTokens <= MAX_TOKENS_PER_SECTION) {
      pushChunk(out, m.heading, m.content);
    } else {
      const pieces = splitByTokens(m.content, MAX_TOKENS_PER_SECTION);
      pieces.forEach((piece, idx) => {
        if (out.length >= MAX_SECTIONS_PER_PAPER) return;
        // Final safety net: if splitter's snap-to-boundary heuristic
        // happened to leave one piece just over the cap (estimator can
        // jitter by 1-2 tokens at boundaries), truncate it.
        const safePiece =
          estimateTokens(piece) > MAX_TOKENS_PER_SECTION
            ? truncateByTokens(piece, MAX_TOKENS_PER_SECTION)
            : piece;
        pushChunk(out, idx === 0 ? m.heading : null, safePiece);
      });
    }
  }

  // Always emit at least one chunk so a tiny paper is still searchable.
  if (out.length === 0 && input.text.trim().length > 0) {
    const truncated = truncateByTokens(input.text.trim(), MAX_TOKENS_PER_SECTION);
    out.push({
      sectionIdx: 0,
      title: input.title ?? null,
      anchor: slugify(input.title ?? 'section-0'),
      content: truncated,
      tokensEstimated: estimateTokens(truncated),
    });
  }
  return out;
}

function isReferenceHeading(heading: string | null): boolean {
  return heading !== null && REFERENCE_HEADING_REGEX.test(heading.trim());
}

function pushChunk(out: SectionChunk[], heading: string | null, content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  const tokens = estimateTokens(trimmed);
  if (tokens > MAX_TOKENS_PER_SECTION) {
    // Last-line defence: the splitter promised this wouldn't happen, but
    // truncate rather than crash if someone hands us pathological input.
    const safe = truncateByTokens(trimmed, MAX_TOKENS_PER_SECTION);
    out.push({
      sectionIdx: out.length,
      title: heading,
      anchor: slugify(heading ?? `section-${out.length + 1}`),
      content: safe,
      tokensEstimated: estimateTokens(safe),
    });
    return;
  }
  // Merge into previous if the new chunk is tiny and there's room. We
  // re-estimate the joined content rather than trusting `a + b` so a
  // concatenation can't sneak over the cap.
  const previousHeading = out.length > 0 ? out[out.length - 1]?.title ?? null : null;
  const keepSeparate = isReferenceHeading(heading) || isReferenceHeading(previousHeading);
  if (!keepSeparate && tokens < SECTION_MIN_TOKENS && out.length > 0) {
    const last = out[out.length - 1]!;
    const joined = `${last.content}\n\n${trimmed}`;
    const joinedTokens = estimateTokens(joined);
    if (joinedTokens <= MAX_TOKENS_PER_SECTION) {
      out[out.length - 1] = { ...last, content: joined, tokensEstimated: joinedTokens };
      return;
    }
  }
  out.push({
    sectionIdx: out.length,
    title: heading,
    anchor: slugify(heading ?? `section-${out.length + 1}`),
    content: trimmed,
    tokensEstimated: tokens,
  });
}

/**
 * Split `text` into pieces such that estimateTokens(piece) ≤ maxTokens.
 * Prefers paragraph (\n\n) and sentence (". ") boundaries; falls back to
 * code-point-aware truncation if no good split is found.
 */
export function splitByTokens(text: string, maxTokens: number): string[] {
  if (maxTokens <= 0) return [];
  const out: string[] = [];
  let remaining = text;
  let guard = 0;
  while (remaining.length > 0) {
    if (++guard > 10_000) break;
    if (estimateTokens(remaining) <= maxTokens) {
      out.push(remaining);
      break;
    }
    // Largest prefix length that still fits. Binary search guarantees this
    // satisfies estimateTokens(text[0..cut]) <= maxTokens.
    const cut = findMaxPrefix(remaining, maxTokens);
    if (cut <= 0) {
      out.push(remaining.slice(0, 1));
      remaining = remaining.slice(1);
      continue;
    }
    // Snap to a nice boundary, but only if it stays within `cut` — we must
    // never push past the token-safe prefix.
    const para = remaining.lastIndexOf('\n\n', cut);
    const sent = remaining.lastIndexOf('. ', cut);
    const space = remaining.lastIndexOf(' ', cut);
    let snapped = cut;
    if (para >= cut * 0.5 && para + 2 <= cut) snapped = para + 2;
    else if (sent >= cut * 0.5 && sent + 2 <= cut) snapped = sent + 2;
    else if (space >= cut * 0.5 && space + 1 <= cut) snapped = space + 1;
    const piece = remaining.slice(0, snapped).trim();
    if (piece.length > 0) out.push(piece);
    remaining = remaining.slice(snapped).trim();
  }
  return out.filter((p) => p.length > 0);
}

/**
 * Largest prefix length `k` in `text` for which estimateTokens(text[0..k]) ≤
 * `maxTokens`. Binary search on code-point boundaries.
 */
function findMaxPrefix(text: string, maxTokens: number): number {
  // Standard "largest k such that f(k) is true" binary search.
  // f(k) = estimateTokens(text.slice(0, k)) <= maxTokens.
  // f(0) is always true; we return the largest k still satisfying f.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  // Step back if we landed in the middle of a surrogate pair, so the result
  // is always at a UTF-16 code-point boundary.
  if (lo > 0 && lo < text.length) {
    const c = text.charCodeAt(lo);
    if (c >= 0xdc00 && c <= 0xdfff) lo -= 1;
  }
  return lo;
}

/**
 * Hard-truncate `text` to at most `maxTokens` tokens. Code-point-aware so
 * we never tear an emoji or CJK pair in half.
 */
export function truncateByTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const cut = findMaxPrefix(text, maxTokens);
  return text.slice(0, cut).trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// =============================================================================
// Indexer service — chunks a paper's text, embeds each section, persists.
// =============================================================================

export interface IndexerResult {
  readonly sectionsIndexed: number;
  readonly sectionsFailed: number;
  readonly failures: ReadonlyArray<{ sectionIdx: number; reason: string }>;
}

export interface SectionsIndexer {
  reindex(input: {
    paperId: string;
    text: string;
    title?: string;
  }): AppResultAsync<IndexerResult>;
}

/**
 * Indexer: chunks → embed every chunk → persist whatever succeeded.
 *
 * Resilience contract:
 *   - A failure to embed one section MUST NOT abort indexing the others.
 *   - If the embedding provider is completely down, every chunk fails, and
 *     we return Ok({sectionsIndexed: 0, sectionsFailed: N}). The caller
 *     decides whether to treat that as a saga failure.
 *   - We only call `replaceForPaper` once at the end, atomically replacing
 *     the section set. Partial intermediate state never lands in the DB.
 */
export function makeSectionsIndexer(ctx: AppContext): SectionsIndexer {
  const { llm } = ctx.clients;
  return {
    reindex({ paperId, text, title }) {
      const chunks = chunkSections({ text, title });
      if (chunks.length === 0) {
        return ResultAsync.fromSafePromise(
          Promise.resolve<IndexerResult>({
            sectionsIndexed: 0,
            sectionsFailed: 0,
            failures: [],
          }),
        );
      }

      // Lazy-import the budget service so we don't blow up the type circle
      // (services/index.ts → sections.ts → services/index.ts).
      const budgetImport = import('./llm-budget.js').then(({ makeLlmBudget }) =>
        makeLlmBudget(ctx),
      );

      const work = async (): Promise<{
        embedded: Array<SectionChunk & { embedding: number[] }>;
        failures: Array<{ sectionIdx: number; reason: string }>;
      }> => {
        const budget = await budgetImport;
        // Run embeds with bounded concurrency so we don't open 80 sockets
        // against the upstream provider in one burst (and so rate-limit
        // failures cluster instead of dominoing).
        const CONCURRENCY = 4;
        const queue = [...chunks];
        const embedded: Array<SectionChunk & { embedding: number[] }> = [];
        const failures: Array<{ sectionIdx: number; reason: string }> = [];

        async function worker(): Promise<void> {
          while (queue.length > 0) {
            const chunk = queue.shift();
            if (!chunk) break;
            // Budget gate before the call — refuses if today's quota is
            // exhausted. A failed budget check is treated as a section
            // failure (same shape), so the rest of the paper still indexes
            // if budget recovers later via partial retry.
            const budgetCheck = await budget.consumeFor('embed', chunk.content);
            if (budgetCheck.isErr()) {
              failures.push({
                sectionIdx: chunk.sectionIdx,
                reason: `budget: ${budgetCheck.error.message}`,
              });
              continue;
            }
            const res = await llm.generateEmbedding(chunk.content, {
              model: ctx.env.GEMINI_MODEL_EMBED,
            });
            if (res.isOk()) {
              embedded.push({ ...chunk, embedding: res.value });
            } else {
              failures.push({
                sectionIdx: chunk.sectionIdx,
                reason: res.error.message,
              });
            }
          }
        }

        const workers = Array.from(
          { length: Math.min(CONCURRENCY, chunks.length) },
          () => worker(),
        );
        await Promise.all(workers);
        // Re-sort because concurrent workers may have completed out of order.
        embedded.sort((a, b) => a.sectionIdx - b.sectionIdx);
        return { embedded, failures };
      };

      return ResultAsync.fromPromise(work(), (cause) =>
        Errors.internal(`sections.indexer paper ${paperId}`, cause),
      ).andThen(({ embedded, failures }) => {
        if (embedded.length === 0) {
          // Nothing landed — return the failure summary instead of corrupting
          // the section table. Caller logs; saga keeps going.
          return ResultAsync.fromSafePromise(
            Promise.resolve<IndexerResult>({
              sectionsIndexed: 0,
              sectionsFailed: failures.length,
              failures,
            }),
          );
        }
        // Re-pack indices densely so the unique-index on (paperId, sectionIdx)
        // doesn't get holes if e.g. section 3 of 8 failed.
        const repacked = embedded.map((s, i) => ({
          sectionIdx: i,
          title: s.title,
          anchor: s.anchor,
          content: s.content,
          embedding: s.embedding,
          model: ctx.env.GEMINI_MODEL_EMBED,
        }));
        return ctx.repos.sections
          .replaceForPaper(paperId, repacked)
          .map<IndexerResult>(() => ({
            sectionsIndexed: embedded.length,
            sectionsFailed: failures.length,
            failures,
          }));
      });
    },
  };
}

// =============================================================================
// Search service — embeds the query, hits pgvector, returns highlighted snippets.
// =============================================================================

export interface SearchResult {
  paperId: string;
  paperTitle: string;
  openxivId: string | null;
  openxivUrlId: string | null;
  sectionIdx: number;
  sectionTitle: string | null;
  anchor: string | null;
  snippetHtml: string;
  distance: number;
}

export interface SearchService {
  search(q: string, limit?: number): AppResultAsync<SearchResult[]>;
}

const SEARCH_QUERY_MAX_LEN = 200;
const SEARCH_LIMIT_MAX = 50;

export function makeSearchService(ctx: AppContext): SearchService {
  const { llm } = ctx.clients;
  const redis = ctx.redis;
  const cacheTtl = ctx.env.SEARCH_CACHE_TTL_SECONDS;

  // Lazy budget import to avoid the type cycle services/index.ts → sections.ts.
  const budgetPromise = import('./llm-budget.js').then(({ makeLlmBudget }) =>
    makeLlmBudget(ctx),
  );

  async function cacheKey(q: string, limit: number): Promise<string> {
    const { createHash } = await import('node:crypto');
    const h = createHash('sha256').update(`${limit}|${q}`).digest('hex').slice(0, 24);
    return `search:results:${h}`;
  }

  async function readCache(q: string, limit: number): Promise<SearchResult[] | null> {
    if (cacheTtl <= 0) return null;
    try {
      const key = await cacheKey(q, limit);
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as SearchResult[];
    } catch {
      return null;
    }
  }
  async function writeCache(q: string, limit: number, results: SearchResult[]): Promise<void> {
    if (cacheTtl <= 0) return;
    try {
      const key = await cacheKey(q, limit);
      await redis.set(key, JSON.stringify(results), 'EX', cacheTtl);
    } catch {
      // Cache write failures should never block a successful query.
    }
  }

  return {
    search(qRaw, limitRaw = 20) {
      const trimmed = (typeof qRaw === 'string' ? qRaw : '').trim().slice(0, SEARCH_QUERY_MAX_LEN);
      const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.floor(limitRaw)));
      if (trimmed.length < 2) {
        return ResultAsync.fromSafePromise(Promise.resolve([]));
      }

      return ResultAsync.fromSafePromise(readCache(trimmed, limit)).andThen((hit) => {
        if (hit) return ResultAsync.fromSafePromise(Promise.resolve(hit));

        // Budget gate — refuses if today's embed-token cap is exhausted.
        const gated = ResultAsync.fromPromise(budgetPromise, (cause) =>
          Errors.internal('search.budgetSetup', cause),
        ).andThen((budget) => budget.consumeFor('embed', trimmed));

        return gated
          .andThen(() => llm.generateEmbedding(trimmed, { model: ctx.env.GEMINI_MODEL_EMBED }))
          .andThen((vec) => ctx.repos.sections.search(vec, limit))
          .andThen((matches) => {
            const paperIds: string[] = Array.from(new Set(matches.map((m) => m.paperId)));
            return ctx.repos.papers
              .loadManyWithRelations(paperIds)
              .map((relations) => {
                const paperMap = new Map<string, (typeof relations)[number]>();
                for (const r of relations) paperMap.set(r.paper.id, r);
                const results: SearchResult[] = [];
                for (const m of matches) {
                  const rel = paperMap.get(m.paperId);
                  if (!rel) continue;
                  results.push({
                    paperId: m.paperId,
                    paperTitle: rel.paper.title,
                    openxivId: rel.paper.openxivId,
                    openxivUrlId: rel.paper.openxivId
                      ? rel.paper.openxivId.replace(/^openxiv:/, '')
                      : null,
                    sectionIdx: m.sectionIdx,
                    sectionTitle: m.title,
                    anchor: m.anchor,
                    snippetHtml: highlight(snippet(m.content, trimmed), trimmed),
                    distance: m.distance,
                  });
                }
                return results;
              });
          })
          .map((results) => {
            // Fire-and-forget cache write so hot queries get cached.
            void writeCache(trimmed, limit, results);
            return results;
          });
      });
    },
  };
}

function snippet(content: string, query: string): string {
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) {
    return content.slice(0, 320);
  }
  const start = Math.max(0, idx - 120);
  const end = Math.min(content.length, idx + q.length + 200);
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
}

function highlight(snippet: string, query: string): string {
  const safe = snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const tokens = query
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (tokens.length === 0) return safe;
  const re = new RegExp(`(${tokens.join('|')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}
