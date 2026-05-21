import {
  computeFeedScore,
  computeTrustPassport,
  computeTrustVectorReadiness,
  TRUST_PASSPORT_LANES,
  type AppResultAsync,
  ResultAsync,
  type TrustIssueLevel,
  type TrustLaneState,
  type TrustPassportLaneKey,
} from '@openxiv/shared';
import type {
  PaperAuthorRecord,
  PaperRecord,
  PaperWithRelations,
  PostRecord,
} from '@openxiv/db';
import type { AppContext } from '../context.js';

export interface PaperFeedItem {
  kind: 'paper';
  createdAt: Date;
  paper: PaperRecord;
  authors: PaperAuthorRecord[];
  weight: number;
  trustPassport: PaperFeedTrustPassport;
}

export interface PaperFeedTrustLane {
  readonly state: TrustLaneState;
  readonly issueLevel: TrustIssueLevel;
  readonly nextActions: ReadonlyArray<string>;
}

export type PaperFeedTrustPassport = Record<TrustPassportLaneKey, PaperFeedTrustLane>;

export interface PostFeedItem {
  kind: 'post';
  createdAt: Date;
  post: PostRecord;
  weight: number;
}

export type FeedItem = PaperFeedItem | PostFeedItem;

export interface FeedService {
  homeFeed(viewerDid: string | null, limit?: number): AppResultAsync<FeedItem[]>;
  profileStream(did: string, limit?: number): AppResultAsync<FeedItem[]>;
}

const POST_FOLLOWED_BOOST = 0.15;
const POST_UNFOLLOWED_BASE = 0.05;
const PAPER_FOLLOWED_BOOST = 0.1; // applied on top of computeFeedScore for papers from followed authors

function ageDays(now: number, ts: Date | null | undefined): number {
  if (!ts) return 9999;
  const t = ts.getTime();
  if (!Number.isFinite(t)) return 9999;
  const diffMs = now - t;
  if (diffMs < 0) return 0; // clock-skew safety
  return diffMs / (1000 * 60 * 60 * 24);
}

function paperScoreFor(rel: PaperWithRelations, followed: boolean, now: number): {
  weight: number;
  trustPassport: PaperFeedTrustPassport;
} {
  const trust = computeTrustPassport({
    hasDisclosure: Boolean(rel.disclosure),
    disclosureLevel: rel.disclosure?.level,
    disclosureHumanVerified: rel.disclosure?.humanVerified,
    disclosedModelCount: rel.disclosure?.models?.length ?? 0,
    detectorScore: rel.detectorScore?.score ?? null,
    hasAnyOrcid: rel.authors.some((a) => Boolean(a.orcid)),
    submitterDidValid:
      rel.paper.submitterDid.startsWith('did:plc:') || rel.paper.submitterDid.startsWith('did:web:'),
    authorCount: rel.authors.length,
    identifiedAuthorCount: rel.authors.filter((a) => Boolean(a.orcid) || Boolean(a.did)).length,
    hasPlainSummary: rel.summaries.length > 0,
    hasSourceArchive: Boolean(rel.latestVersion?.sourceKey),
    hasCompiledPdf: Boolean(rel.latestVersion?.finalPdfUrl || rel.latestVersion?.pdfKey),
    hasHtmlRendering: Boolean(rel.latestVersion?.htmlKey),
    hasFileHash: Boolean(rel.latestVersion?.fileSha256 || rel.latestVersion?.finalPdfContentHash),
    provenanceCompletion: rel.latestVersion ? null : 0,
    endorsementCount: 0,
    distinctEndorsementVerbs: 0,
  });
  const readiness = computeTrustVectorReadiness(trust);
  const baseScore = computeFeedScore({
    ageDays: ageDays(now, rel.paper.publishedAt ?? rel.paper.createdAt),
    semanticSimilarity: 0, // viewer-aware semantic ranking is Phase-2
    trustVectorReadiness: readiness.readiness,
    blockedLaneCount: readiness.blockedLaneCount,
    unresolvedDisputeCount: readiness.unresolvedDisputeCount,
  });
  return {
    weight: baseScore + (followed ? PAPER_FOLLOWED_BOOST : 0),
    trustPassport: summarizeTrustPassportForFeed(trust),
  };
}

function summarizeTrustPassportForFeed(
  trust: ReturnType<typeof computeTrustPassport>,
): PaperFeedTrustPassport {
  const summary: Partial<PaperFeedTrustPassport> = {};
  for (const lane of TRUST_PASSPORT_LANES) {
    summary[lane] = {
      state: trust[lane].state,
      issueLevel: trust[lane].issueLevel,
      nextActions: trust[lane].nextActions,
    };
  }
  return summary as PaperFeedTrustPassport;
}

export function makeFeedService(ctx: AppContext): FeedService {
  const { papers, posts, follows } = ctx.repos;

  return {
    homeFeed(viewerDid, limit = 30) {
      const cappedLimit = Math.max(1, Math.min(limit, 100));
      const followsResult = viewerDid
        ? follows.followingDids(viewerDid)
        : ResultAsync.fromSafePromise(Promise.resolve<string[]>([]));

      return followsResult.andThen((followingDids) => {
        const followSet = new Set(followingDids);
        return ResultAsync.combine([
          posts.feedFromDids(followingDids, cappedLimit),
          posts.listRecent(cappedLimit * 2),
          papers.list({ status: 'published', limit: cappedLimit * 3 }),
        ]).andThen(([followedPosts, recentPosts, publishedPapers]) => {
          const seenPostUris = new Set<string>();
          const postItems: PostFeedItem[] = [];
          for (const p of followedPosts) {
            seenPostUris.add(p.uri);
            postItems.push({ kind: 'post', createdAt: p.createdAt, post: p, weight: POST_FOLLOWED_BOOST });
          }
          for (const p of recentPosts) {
            if (seenPostUris.has(p.uri)) continue;
            if (followSet.has(p.authorDid)) continue;
            postItems.push({ kind: 'post', createdAt: p.createdAt, post: p, weight: POST_UNFOLLOWED_BASE });
          }

          // Hydrate paper relations in a single batch so we can compute the
          // trust-weighted feed score correctly per paper.
          return papers
            .loadManyWithRelations(publishedPapers.map((p) => p.id))
            .map((relations) => {
              const now = Date.now();
              const items: FeedItem[] = [...postItems];
              for (const rel of relations) {
                const followed = followSet.has(rel.paper.submitterDid);
                const { weight, trustPassport } = paperScoreFor(rel, followed, now);
                items.push({
                  kind: 'paper',
                  createdAt: rel.paper.publishedAt ?? rel.paper.createdAt,
                  paper: rel.paper,
                  authors: rel.authors,
                  weight,
                  trustPassport,
                });
              }
              items.sort((a, b) => {
                const diff = b.weight - a.weight;
                if (Math.abs(diff) > 1e-6) return diff;
                return b.createdAt.getTime() - a.createdAt.getTime();
              });
              return items.slice(0, cappedLimit);
            });
        });
      });
    },

    profileStream(did, limit = 50) {
      const cappedLimit = Math.max(1, Math.min(limit, 100));
      return ResultAsync.combine([
        papers.list({ submitterDid: did, limit: cappedLimit }),
        posts.listByAuthor(did, cappedLimit),
      ]).andThen(([userPapers, userPosts]) => {
        return papers.loadManyWithRelations(userPapers.map((p) => p.id)).map((rels) => {
          const relById = new Map(rels.map((r) => [r.paper.id, r]));
          const items: FeedItem[] = [];
          for (const paper of userPapers) {
            const rel = relById.get(paper.id);
            const trust = rel
              ? computeTrustPassport({
                  hasDisclosure: Boolean(rel.disclosure),
                  disclosureLevel: rel.disclosure?.level,
                  disclosureHumanVerified: rel.disclosure?.humanVerified,
                  disclosedModelCount: rel.disclosure?.models?.length ?? 0,
                  detectorScore: rel.detectorScore?.score ?? null,
                  hasAnyOrcid: rel.authors.some((a) => Boolean(a.orcid)),
                  submitterDidValid:
                    rel.paper.submitterDid.startsWith('did:plc:') ||
                    rel.paper.submitterDid.startsWith('did:web:'),
                  authorCount: rel.authors.length,
                  identifiedAuthorCount: rel.authors.filter((a) => Boolean(a.orcid) || Boolean(a.did)).length,
                  hasPlainSummary: rel.summaries.length > 0,
                  hasSourceArchive: Boolean(rel.latestVersion?.sourceKey),
                  hasCompiledPdf: Boolean(rel.latestVersion?.finalPdfUrl || rel.latestVersion?.pdfKey),
                  hasHtmlRendering: Boolean(rel.latestVersion?.htmlKey),
                  hasFileHash: Boolean(rel.latestVersion?.fileSha256 || rel.latestVersion?.finalPdfContentHash),
                  provenanceCompletion: rel.latestVersion ? null : 0,
                  endorsementCount: 0,
                  distinctEndorsementVerbs: 0,
                })
              : null;
            items.push({
              kind: 'paper',
              createdAt: paper.publishedAt ?? paper.createdAt,
              paper,
              authors: rel?.authors ?? [],
              weight: 0,
              trustPassport: trust ? summarizeTrustPassportForFeed(trust) : emptyTrustPassportSummary(),
            });
          }
          for (const post of userPosts) {
            items.push({ kind: 'post', createdAt: post.createdAt, post, weight: 0 });
          }
          items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return items.slice(0, cappedLimit);
        });
      });
    },
  };
}

function emptyTrustPassportSummary(): PaperFeedTrustPassport {
  const summary: Partial<PaperFeedTrustPassport> = {};
  for (const lane of TRUST_PASSPORT_LANES) {
    summary[lane] = {
      state: 'pending',
      issueLevel: 'watch',
      nextActions: ['Load Trust Passport evidence.'],
    };
  }
  return summary as PaperFeedTrustPassport;
}
