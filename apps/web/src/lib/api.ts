/**
 * Typed REST client used by Astro pages (server-side) and React islands
 * (client-side). The two paths resolve different base URLs:
 *   - server-side (Astro page): INTERNAL_API_BASE so docker can reach api:4000
 *   - client-side (React): PUBLIC_API_BASE so the browser hits localhost:4000
 *
 * `process.env` is read at runtime, not inlined at build like `import.meta.env`.
 * That matters in Docker: the image is built once without knowing the runtime
 * service hostname, and INTERNAL_API_BASE only exists when the container starts.
 */
import type { CategoryBrowse } from '@openxiv/shared';

const SERVER_BASE =
  (typeof process !== 'undefined' && process.env?.INTERNAL_API_BASE) ||
  (typeof process !== 'undefined' && process.env?.PUBLIC_API_BASE) ||
  import.meta.env.PUBLIC_API_BASE ||
  'http://localhost:4000';

// Browser calls go through the Astro proxy so cookies stay on the web origin.
const CLIENT_BASE = '/api-proxy';

const FORWARDED_REQUEST_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'user-agent',
] as const;

type ForwardedRequestSource = Headers | Request | null | undefined;

function requestHeadersFrom(source: ForwardedRequestSource): Headers | null {
  if (!source) return null;
  return source instanceof Headers ? source : source.headers;
}

function forwardedRequestHeaders(source: ForwardedRequestSource): Headers {
  const src = requestHeadersFrom(source);
  const out = new Headers();
  if (!src) return out;
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = src.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

export type DisclosureLevel = 'none' | 'assistant' | 'coauthor' | 'primary';

export type TrustLaneState = 'strong' | 'partial' | 'absent' | 'pending';
export type TrustIssueLevel = 'none' | 'watch' | 'needs-work' | 'blocked';
export type TrustPassportLaneKey =
  | 'transparency'
  | 'identity'
  | 'provenance'
  | 'citations'
  | 'math'
  | 'integrity'
  | 'socialReview';

export interface TrustCheck {
  label: string;
  passed: boolean;
  status?: 'pass' | 'fail' | 'pending' | 'not_applicable';
  note: string;
  weight?: number;
  value?: number | null;
  severity?: 'info' | 'low' | 'medium' | 'high';
  source?: 'author' | 'pipeline' | 'identity' | 'community';
  action?: string;
  ref?: string;
  resolved?: string | null;
  via?: 'doi' | 'arxiv' | 'url' | 'unresolved';
  confidence?: 'high' | 'medium' | 'low';
  reason?: string;
  category?: string;
  section?: string;
  anchor?: string | null;
  snippet?: string;
}

export interface TrustLane {
  state: TrustLaneState;
  score: number;
  confidence?: number;
  issueLevel?: TrustIssueLevel;
  checks: TrustCheck[];
  nextActions?: string[];
}

export interface TrustPassport {
  transparency: TrustLane;
  identity: TrustLane;
  provenance: TrustLane;
  citations: TrustLane;
  math: TrustLane;
  integrity: TrustLane;
  socialReview: TrustLane;
  transparencyScore: number;
}

export interface FeedTrustLane {
  state: TrustLaneState;
  issueLevel: TrustIssueLevel;
  nextActions: string[];
}

export type FeedTrustPassport = Record<TrustPassportLaneKey, FeedTrustLane>;

export type PassportLaneStatus = 'green' | 'yellow' | 'red' | 'pending';

export interface TrustPassportBundleCheck {
  lane: TrustPassportLaneKey;
  checker: string;
  status: PassportLaneStatus;
  issueLevel: TrustIssueLevel;
  nextActions: string[];
  summary: TrustPassportLaneSummary;
  items: TrustCheck[];
}

export interface TrustPassportLaneSummary {
  passedItems: number;
  attentionItems: number;
  pendingItems: number;
  notApplicableItems: number;
  disputeCount: number;
  unresolvedDisputeCount: number;
  highlightedDisputeCount: number;
  responseCount: number;
  externalAttestationCount: number;
  verifiedExternalAttestationCount: number;
  unverifiedExternalAttestationCount: number;
  historyState:
    | 'computed'
    | 'externally_attested'
    | 'contested'
    | 'answered_contestation'
    | 'contested_and_attested';
  lastActivityAt: string | null;
  topAction?: string;
}

export interface SignedTrustPassportBundle {
  '@context': unknown[];
  type: 'OpenXivTrustPassport';
  id: string;
  paper_id: string;
  paper_uuid: string;
  paper_url: string;
  title: string;
  version_id: string | null;
  generatedAt: string;
  issuer: string;
  semanticDigest: string;
  checks: TrustPassportBundleCheck[];
  publicDisputes: PassportPublicDispute[];
  publicDisputeResponses: PassportPublicDisputeResponse[];
  externalAttestations: PassportExternalAttestation[];
  history: TrustPassportHistoryEvent[];
  proof: {
    type: 'EcdsaSecp256k1Signature2019';
    created: string;
    proofPurpose: 'assertionMethod';
    verificationMethod: string;
    canonicalizationAlgorithm: 'openxiv-json-canonical-v1';
    digestAlgorithm: 'SHA-256';
  };
  signature: string;
}

export interface TrustPassportHistoryEvent {
  id: string;
  type: 'public_dispute' | 'dispute_response' | 'external_attestation';
  lane: TrustPassportBundleCheck['lane'];
  actorDid: string;
  uri: string;
  createdAt: string;
  text?: string;
  statement?: string;
  targetRef?: string | null;
  status?: 'open' | 'highlighted' | 'resolved';
  relatedId?: string;
  relatedUri?: string | null;
  issuer?: string;
  publicKeyMultibase?: string;
  signature?: string;
  signatureVerified?: boolean;
  verificationUrl?: string | null;
}

export interface PassportPublicDispute {
  id: string;
  uri: string;
  lane: TrustPassportBundleCheck['lane'];
  authorDid: string;
  text: string;
  targetRef: string | null;
  status: 'open' | 'highlighted' | 'resolved';
  createdAt: string;
}

export interface PassportPublicDisputeResponse {
  id: string;
  uri: string;
  disputeId: string;
  disputeUri: string | null;
  lane: TrustPassportBundleCheck['lane'];
  authorDid: string;
  text: string;
  createdAt: string;
}

export interface PassportExternalAttestation {
  id: string;
  uri: string;
  issuer: string;
  publicKeyMultibase: string;
  lane: TrustPassportBundleCheck['lane'];
  statement: string;
  signature: string;
  signatureVerified: boolean;
  verificationUrl: string | null;
  createdAt: string;
}

export interface PassportDisputeResponse {
  id: string;
  uri: string;
  lane: TrustPassportBundleCheck['lane'];
  targetRef: string | null;
  text: string;
  authorDid: string;
  createdAt: string;
}

export interface PassportDisputeResponseRecord {
  id: string;
  uri: string;
  disputeId: string;
  disputeUri: string | null;
  lane: TrustPassportBundleCheck['lane'];
  authorDid: string;
  text: string;
  createdAt: string;
}

export interface PassportDisputeStatusResponse {
  id: string;
  uri: string;
  lane: TrustPassportBundleCheck['lane'];
  status: 'open' | 'highlighted' | 'resolved';
  label: string | null;
  updatedAt: string;
}

export interface PassportVerifyResponse {
  ok: boolean;
  rerunAt: string;
  signatureValid: boolean;
  semanticDigest: string;
  matchesBaseline: boolean | null;
  comparison:
    | {
        mode: 'none';
        baselineDigest: null;
        currentDigest: string;
        changed: null;
        changedLanes: [];
        historyDelta: null;
        publicDisputeDelta: null;
        externalAttestationDelta: null;
      }
    | {
        mode: 'digest';
        baselineDigest: string;
        currentDigest: string;
        changed: boolean;
        changedLanes: [];
        historyDelta: null;
        publicDisputeDelta: null;
        externalAttestationDelta: null;
      }
    | {
        mode: 'bundle';
        baselineSignatureValid: boolean;
        baselineDigest: string;
        currentDigest: string;
        changed: boolean;
        changedLanes: Array<{
          lane: TrustPassportBundleCheck['lane'];
          baselineStatus: PassportLaneStatus | null;
          currentStatus: PassportLaneStatus;
          baselineIssueLevel: TrustIssueLevel | null;
          currentIssueLevel: TrustIssueLevel;
          baselineSummary: TrustPassportLaneSummary | null;
          currentSummary: TrustPassportLaneSummary;
        }>;
        historyDelta: number;
        publicDisputeDelta: number;
        externalAttestationDelta: number;
      };
  generatedAt: string;
  versionId: string | null;
  lanes: Array<{
    lane: TrustPassportBundleCheck['lane'];
    status: PassportLaneStatus;
    issueLevel: 'none' | 'watch' | 'needs-work' | 'blocked';
    summary: TrustPassportLaneSummary;
  }>;
  passport: SignedTrustPassportBundle;
}
export type SummaryTier = 'school' | 'undergrad' | 'expert';
export type PaperStatus =
  | 'draft'
  | 'compiling'
  | 'compile_failed'
  | 'pending_disclosure'
  | 'pending_review'
  | 'published'
  | 'withdrawn';

export interface UserMeResponse {
  authenticated: boolean;
  user?: {
    id: string;
    did: string;
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
    email: string | null;
    orcid: string | null;
    role: 'author' | 'moderator' | 'admin';
  };
}

export interface PaperSummary {
  id: string;
  openxivId: string | null;
  openxivUrlId: string | null;
  uri: string | null;
  title: string;
  primaryCategory: string;
  /**
   * Up to 2 cross-listed category codes. Empty for papers submitted
   * before the multi-category release, or for papers that opted into
   * exactly one category. Each value links to its own /topics/{code}
   * feed and matches the GIN-indexed `cross_listings @>` predicate on
   * the server.
   */
  crossListings?: string[];
  status: PaperStatus;
  publishedAt: string | null;
  createdAt: string;
  submitterDid: string;
  authorNames?: string[];
  authorLine?: string;
  /**
   * First-figure thumbnail URL when the figure-extractor has run for
   * this paper. Falls back to the cover image client-side when absent.
   */
  thumbUrl?: string | null;
}

export interface SubmissionFeedback {
  reasonCategory: 'slop' | 'scope' | 'duplicate' | 'legal' | 'other';
  fixable: boolean;
  examples: Array<{ section?: string; problem: string; suggestion?: string }>;
  moderatorNote: string;
  issuedByDid: string;
  issuedAt: string;
}

export interface MySubmission extends PaperSummary {
  abstract: string | null;
  updatedAt: string;
  feedback: SubmissionFeedback | null;
}

export interface ModerationQueueItem {
  id: string;
  openxivId: string | null;
  title: string;
  abstract: string | null;
  primaryCategory: string;
  crossListings: string[];
  status: PaperStatus;
  submitterDid: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: {
    id: string;
    versionNumber: number;
    pdfKey: string | null;
    htmlKey: string | null;
    sourceKey: string | null;
    fileSha256: string | null;
  } | null;
}

export type ModerationDecision =
  | { decision: 'accept' }
  | {
      decision: 'reject_conditionally' | 'reject';
      reasonCategory?: 'slop' | 'scope' | 'duplicate' | 'legal' | 'other';
      examples?: Array<{ section?: string; problem: string; suggestion?: string }>;
      moderatorNote: string;
    };

export interface PaperAuthor {
  position: number;
  displayName: string;
  orcid: string | null;
  affiliation: string | null;
  did: string | null;
  isCorresponding: boolean;
}

export interface LaunchKitPayload {
  bridgeThread?: string[];
  reviewerInvites?: string[];
  figureAltText?: Record<string, string>;
  claimCards?: Array<{ headline: string; supporting: string }>;
}

export interface PaperDetail extends PaperSummary {
  abstract: string | null;
  license: string;
  categories: string[];
  keywords: string[];
  doi: string | null;
  updatedAt: string;
  authors: PaperAuthor[];
  latestVersion: {
    id: string;
    versionNumber: number;
    fileSha256: string | null;
    sizeBytes: number | null;
    pageCount: number | null;
    pdfUrl: string | null;
    htmlUrl: string | null;
    bskyPostUri: string | null;
    bridgeStatus: string;
    mastodonStatusId: string | null;
    mastodonStatusUrl: string | null;
    mastodonPostStatus: string;
  } | null;
  disclosure: {
    level: DisclosureLevel;
    aiUsed: string[];
    models: Array<{ name: string; vendor?: string; version?: string; usage?: string }>;
    notes: string | null;
    summaryAiGenerated: boolean;
    humanVerified: boolean;
    attestation: string;
  } | null;
  summaries: Array<{
    tier: SummaryTier;
    text: string;
    aiGenerated: boolean;
    aiModel: string | null;
    createdAt: string;
  }>;
  saga: {
    stages: {
      paperPersisted: boolean;
      paperApproved: boolean;
      idAssigned: boolean;
      pdsPaper: boolean;
      pdsSummaryDisclosure: boolean;
      blueskyBridge: boolean;
    };
    lastError: string | null;
    lastErrorStage: string | null;
    attempts: number;
  } | null;
  trust?: TrustPassport;
  oneHardQuestion: string | null;
  launchKit: LaunchKitPayload | null;
  provenance?: {
    stages: Array<{
      key:
        | 'uploaded'
        | 'compiled'
        | 'metadata'
        | 'disclosure'
        | 'pds'
        | 'id'
        | 'indexed'
        | 'bridged';
      label: string;
      done: boolean;
      completedAt: string | null;
    }>;
    completion: number;
  };
}

export interface PaperAnalyticsResponse {
  views24h: number;
  viewsTotal: number;
  downloadsTotal: number;
  htmlOpensTotal: number;
  endorsementsTotal: number;
  views7d: number;
  views30d: number;
  topReferrers: Array<{ host: string; count: number }>;
  countries: Array<{ country: string; count: number }>;
  sparkline: Array<{ ts: string; views: number; downloads: number; htmlOpens: number }>;
}

export interface EngagementResponse {
  endorsements: {
    count: number;
    breakdown: Record<string, number>;
  };
  reads: {
    views: number;
    html_opens: number;
    pdf_downloads: number;
  };
  citations: number | null;
}

export interface FeedItemPaper {
  kind: 'paper';
  createdAt: string;
  trustPassport: FeedTrustPassport;
  paper: PaperSummary;
}

export interface FeedItemPost {
  kind: 'post';
  createdAt: string;
  post: {
    id: string;
    uri: string;
    authorDid: string;
    text: string;
    embedPaperUri: string | null;
  };
}

export type FeedItem = FeedItemPaper | FeedItemPost;

export class ApiClient {
  constructor(
    private readonly base: string,
    private readonly cookie?: string,
    forwardedRequest?: ForwardedRequestSource,
  ) {
    this.forwardedHeaders = forwardedRequestHeaders(forwardedRequest);
  }

  private readonly forwardedHeaders: Headers;

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(this.forwardedHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (this.cookie) headers.set('cookie', this.cookie);
    if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const res = await fetch(`${this.base}${path}`, { ...init, headers, credentials: 'include' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`API ${res.status} ${path}: ${detail.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  me(): Promise<UserMeResponse> {
    return this.request<UserMeResponse>('/api/auth/me');
  }

  feedHome(limit = 30): Promise<{ items: FeedItem[] }> {
    return this.request<{ items: FeedItem[] }>(`/api/feed/home?limit=${limit}`);
  }

  bskyTimeline(opts: { limit?: number; cursor?: string } = {}): Promise<{
    feed: Array<{
      post?: {
        uri?: string;
        author?: { handle?: string; displayName?: string };
        record?: { text?: string; createdAt?: string; embed?: unknown };
        embed?: unknown;
      };
      reason?: unknown;
    }>;
    cursor?: string;
  }> {
    const params = new URLSearchParams();
    params.set('limit', String(opts.limit ?? 30));
    if (opts.cursor) params.set('cursor', opts.cursor);
    return this.request(`/api/feed/bsky?${params.toString()}`);
  }

  listPapers(
    opts: { limit?: number; offset?: number; category?: string } = {},
  ): Promise<{ items: PaperSummary[] }> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.offset) params.set('offset', String(opts.offset));
    if (opts.category) params.set('category', opts.category);
    const qs = params.toString();
    return this.request<{ items: PaperSummary[] }>(`/api/papers${qs ? `?${qs}` : ''}`);
  }

  getPaper(id: string): Promise<PaperDetail> {
    return this.request<PaperDetail>(`/api/papers/${id}`);
  }

  getPaperPassport(id: string): Promise<SignedTrustPassportBundle> {
    return this.request<SignedTrustPassportBundle>(
      `/api/papers/${encodeURIComponent(id)}/passport`,
    );
  }

  verifyPaperPassport(
    id: string,
    input: { baselineDigest?: string; baselinePassport?: SignedTrustPassportBundle } = {},
  ): Promise<PassportVerifyResponse> {
    return this.request<PassportVerifyResponse>(
      `/api/papers/${encodeURIComponent(id)}/passport/verify`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  createPassportDispute(
    id: string,
    input: { lane: TrustPassportBundleCheck['lane']; text: string; targetRef?: string },
  ): Promise<PassportDisputeResponse> {
    return this.request<PassportDisputeResponse>(
      `/api/papers/${encodeURIComponent(id)}/passport/disputes`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  createPassportDisputeResponse(
    id: string,
    disputeId: string,
    input: { text: string },
  ): Promise<PassportDisputeResponseRecord> {
    return this.request<PassportDisputeResponseRecord>(
      `/api/papers/${encodeURIComponent(id)}/passport/disputes/${encodeURIComponent(disputeId)}/responses`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  updatePassportDisputeStatus(
    id: string,
    disputeId: string,
    input: { status: 'open' | 'highlighted' | 'resolved' },
  ): Promise<PassportDisputeStatusResponse> {
    return this.request<PassportDisputeStatusResponse>(
      `/api/papers/${encodeURIComponent(id)}/passport/disputes/${encodeURIComponent(disputeId)}/status`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  /**
   * Tier-2 figure list — empty array when the pdf-figures worker hasn't
   * run yet or GROBID detected no figures. The abs page renders a
   * gallery when the response is non-empty.
   */
  getPaperFigures(id: string): Promise<{
    figures: Array<{
      idx: number;
      imageUrl: string;
      caption: string | null;
      page: number | null;
      type: 'figure' | 'table';
      version: number;
    }>;
    extraction:
      | {
          status: 'complete';
          source: 'source_archive' | 'pdf_grobid';
          reason:
            | 'source_archive_figures'
            | 'source_archive_no_figures'
            | 'pdf_grobid_figures'
            | 'pdf_grobid_no_figures';
          figureCount: number;
          completedAt: string;
        }
      | { status: 'pending' };
  }> {
    return this.request(`/api/papers/${encodeURIComponent(id)}/figures`);
  }

  paperAnalytics(id: string): Promise<PaperAnalyticsResponse> {
    return this.request(`/api/papers/${encodeURIComponent(id)}/analytics`);
  }

  paperEngagement(id: string): Promise<EngagementResponse> {
    return this.request(`/api/papers/${encodeURIComponent(id)}/engagement`);
  }

  profileInsights(identifier: string): Promise<{
    generatedAt: string;
    items: Array<{
      id: string;
      openxivId: string | null;
      openxivUrlId: string | null;
      uri: string | null;
      title: string;
      publishedAt: string | null;
      createdAt: string;
      analytics: PaperAnalyticsResponse;
    }>;
  }> {
    return this.request(`/api/profiles/${encodeURIComponent(identifier)}/insights`);
  }

  mySubmissions(): Promise<{ identities: string[]; items: MySubmission[] }> {
    return this.request('/api/me/submissions');
  }

  adminStats(): Promise<{
    generatedAt: string;
    totalSubmissions: number;
    totalEndorsements: number;
    dau: number;
    trending: Array<{ targetUri: string; views24h: number }>;
  }> {
    return this.request('/api/admin/stats');
  }

  moderationQueue(): Promise<{
    actor: { userId: string; did: string; role: 'admin' | 'moderator' };
    items: ModerationQueueItem[];
  }> {
    return this.request('/api/admin/moderation');
  }

  decideModeration(
    paperId: string,
    decision: ModerationDecision,
  ): Promise<{
    ok: boolean;
    paperId: string;
    decision: ModerationDecision['decision'];
  }> {
    return this.request(`/api/admin/moderation/papers/${encodeURIComponent(paperId)}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
    });
  }

  retrySaga(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/papers/${id}/retry`, { method: 'POST' });
  }

  explain(
    id: string,
    tier: SummaryTier,
  ): Promise<{ tier: SummaryTier; text: string; model: string; cached: boolean }> {
    return this.request(`/api/papers/${id}/explain`, {
      method: 'POST',
      body: JSON.stringify({ tier }),
    });
  }

  profileExtras(did: string): Promise<{
    did: string;
    modes: string[];
    cards: {
      ai_policy: {
        models_used?: string[];
        models_avoided?: string[];
        use_cases?: string[];
        verification_practice?: string;
        failure_modes?: string;
      } | null;
      reading_guide: {
        prerequisites?: string;
        start_here?: string;
        avoid_starting_with?: string;
        common_pitfalls?: string;
      } | null;
    };
  }> {
    return this.request(`/api/profiles/${encodeURIComponent(did)}/extras`);
  }

  myProfileSettings(): Promise<{
    modes: Array<{ mode: string; enabled: boolean; public: boolean }>;
    cards: Record<string, { cardType: string; content: Record<string, unknown> }>;
  }> {
    return this.request('/api/me/profile');
  }

  setMode(
    mode: string,
    enabled: boolean,
    isPublic: boolean,
  ): Promise<{ mode: string; enabled: boolean; public: boolean }> {
    return this.request('/api/me/profile/modes', {
      method: 'PATCH',
      body: JSON.stringify({ mode, enabled, public: isPublic }),
    });
  }

  setProfileCard(
    cardType: 'ai_policy' | 'reading_guide',
    content: Record<string, unknown>,
  ): Promise<{ cardType: string; content: Record<string, unknown> }> {
    return this.request(`/api/me/profile/cards/${cardType}`, {
      method: 'PUT',
      body: JSON.stringify(content),
    });
  }

  /** List the Bluesky feeds OpenXiv hosts, for the /feeds page. */
  listBskyFeeds(): Promise<{
    did: string;
    feeds: Array<{ name: string; displayName: string; description: string }>;
  }> {
    return this.request('/api/bsky/feeds');
  }

  /** Trigger Bluesky follow-graph import for the signed-in user. */
  importBskyFollows(): Promise<{ count: number; capped: boolean }> {
    return this.request('/api/me/bluesky/follows/import', { method: 'POST' });
  }

  /** Forget all mirrored Bluesky follows for the signed-in user. */
  forgetBskyFollows(): Promise<{ count: number }> {
    return this.request('/api/me/bluesky/follows', { method: 'DELETE' });
  }

  /** Does the viewer follow the candidate DID on Bluesky? Used on /u/{handle}. */
  checkBskyFollows(did: string): Promise<{ follows: boolean }> {
    return this.request(`/api/me/bluesky/follows/check?did=${encodeURIComponent(did)}`);
  }

  profile(identifier: string): Promise<{
    id: string;
    did: string;
    handle: string | null;
    displayName: string;
    avatarUrl: string | null;
    orcid: string | null;
    role: string;
    bio: string | null;
  }> {
    return this.request(`/api/profiles/${encodeURIComponent(identifier)}`);
  }

  profileStream(did: string, limit = 30): Promise<{ items: FeedItem[] }> {
    return this.request(`/api/profiles/${encodeURIComponent(did)}/stream?limit=${limit}`);
  }

  createPost(input: { text: string; embedPaperUri?: string }): Promise<{
    id: string;
    uri: string;
    cid: string;
    text: string;
    createdAt: string;
  }> {
    return this.request('/api/posts', { method: 'POST', body: JSON.stringify(input) });
  }

  follow(targetDid: string): Promise<{ ok: boolean }> {
    return this.request('/api/follows', { method: 'POST', body: JSON.stringify({ targetDid }) });
  }

  unfollow(targetDid: string): Promise<{ ok: boolean }> {
    return this.request(`/api/follows/${encodeURIComponent(targetDid)}`, { method: 'DELETE' });
  }

  refusal(paperId: string): Promise<{
    paperId: string;
    reasonCategory: 'slop' | 'scope' | 'duplicate' | 'legal' | 'other';
    fixable: boolean;
    examples: Array<{ section?: string; problem: string; suggestion?: string }>;
    moderatorNote: string;
    issuedByDid: string;
    issuedAt: string;
    rescindedAt: string | null;
  }> {
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/refusal`);
  }

  listDiscussion(paperId: string): Promise<{
    items: Array<{
      id: string;
      uri: string;
      authorDid: string;
      text: string;
      label: string | null;
      pinnedByAuthor: boolean;
      hiddenByMod: boolean;
      createdAt: string;
    }>;
    canDiscuss: boolean;
    viewerCanModerate?: boolean;
    viewerIsAuthor?: boolean;
    reason?: string;
  }> {
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/discussion`);
  }

  topic(
    slug: string,
    limit = 30,
  ): Promise<{
    slug: string;
    kind: 'category' | 'keyword';
    label: string;
    blurb: string | null;
    oaiSetSpec: string | null;
    papers: Array<{
      paperId: string;
      openxivId: string | null;
      openxivUrlId: string | null;
      title: string;
      abstractFragment: string | null;
      publishedAt: string | null;
      primaryCategory: string;
    }>;
  }> {
    return this.request(`/api/topics/${encodeURIComponent(slug)}?limit=${limit}`);
  }

  async categoryBrowse(): Promise<CategoryBrowse> {
    // Prod API may still serve `/api/topics/categories` as the legacy
    // topic-by-slug lookup (returns `{slug, kind, label, ...}`). Validate
    // the new shape and throw if mismatched so callers can fall back via
    // `.catch(() => buildCategoryBrowse({}))` cleanly.
    const response = await this.request<unknown>('/api/topics/categories');
    if (
      !response ||
      typeof response !== 'object' ||
      !Array.isArray((response as { groups?: unknown }).groups)
    ) {
      throw new Error('categoryBrowse: API returned legacy shape (groups missing). Deploy new endpoint.');
    }
    return response as CategoryBrowse;
  }

  listVersions(paperId: string): Promise<{
    items: Array<{
      id: string;
      versionNumber: number;
      createdAt: string;
      publishedAt: string | null;
      fileSha256: string | null;
      changelog: {
        changeFlags: Record<string, boolean>;
        becauseOf: string | null;
        unresolved: string | null;
        note: string | null;
        diffUrl: string | null;
        previousVersionId: string | null;
      } | null;
    }>;
    becauseOfOptions: readonly string[];
  }> {
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/versions`);
  }

  listEndorsements(
    paperId: string,
    opts: { verb?: string } = {},
  ): Promise<{
    items: Array<{
      id: string;
      uri: string;
      endorserDid: string;
      verb: string | null;
      note: string | null;
      createdAt: string;
    }>;
    stats: { total: number; distinctVerbs: number; byVerb: Record<string, number> };
    verbs: readonly string[];
  }> {
    const qs = opts.verb ? `?verb=${encodeURIComponent(opts.verb)}` : '';
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/endorsements${qs}`);
  }

  endorse(
    paperId: string,
    input: { verb: string; note?: string },
  ): Promise<{
    id: string;
    uri: string;
    verb: string | null;
    note: string | null;
    createdAt: string;
  }> {
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/endorsements`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  unendorse(paperId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/endorsements/mine`, {
      method: 'DELETE',
    });
  }

  authorizeUrl(
    provider: 'orcid' | 'google' | 'bluesky',
    redirectAfter?: string,
  ): Promise<{ url: string; state: string }> {
    const params = new URLSearchParams();
    if (redirectAfter) params.set('redirect_after', redirectAfter);
    const qs = params.toString();
    return this.request(`/api/auth/${provider}/login${qs ? `?${qs}` : ''}`);
  }

  startBlueskyAuth(input: {
    handle: string;
    redirectAfter?: string;
    intent?: 'signin' | 'link';
  }): Promise<{ url: string }> {
    return this.request('/api/auth/bluesky/start', {
      method: 'POST',
      body: JSON.stringify({
        handle: input.handle,
        ...(input.redirectAfter ? { redirect_after: input.redirectAfter } : {}),
        ...(input.intent ? { intent: input.intent } : {}),
      }),
    });
  }
}

export function serverClient(
  cookie?: string,
  forwardedRequest?: ForwardedRequestSource,
): ApiClient {
  return new ApiClient(SERVER_BASE, cookie, forwardedRequest);
}

export function browserClient(): ApiClient {
  return new ApiClient(CLIENT_BASE);
}
