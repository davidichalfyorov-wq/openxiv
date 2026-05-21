import {
  TRUST_PASSPORT_LANES,
  type TrustIssueLevel,
  type TrustLaneState,
  type TrustPassport,
  type TrustPassportLaneKey,
} from './trust-passport.js';

/**
 * Legacy Trust Score — 0..100 — quantifies how transparent a paper is, NOT how
 * correct it is. New user-facing Trust Passport surfaces must use the lane
 * vector from `computeTrustPassport`; this scalar remains for older internal
 * compatibility only.
 *
 * Components (point allocation totals 100):
 *   disclosure     40 — author attested to AI use (any level, including "none")
 *   detector       20 — if level=none, ensemble score below threshold; otherwise pass-through
 *   orcidVerified  20 — at least one author has an ORCID iD attached
 *   plainSummary   20 — a plain-language summary was supplied for any tier
 */

export interface TrustInputs {
  readonly hasDisclosure: boolean;
  readonly disclosureLevel?: 'none' | 'assistant' | 'coauthor' | 'primary' | undefined;
  readonly detectorScore: number | null;
  readonly detectorThreshold?: number;
  readonly hasAnyOrcid: boolean;
  readonly hasPlainSummary: boolean;
}

export interface TrustBreakdown {
  readonly disclosure: { passed: boolean; weight: 40; reason: string };
  readonly detector: { passed: boolean; weight: 20; reason: string };
  readonly orcidVerified: { passed: boolean; weight: 20; reason: string };
  readonly plainSummary: { passed: boolean; weight: 20; reason: string };
}

export interface TrustScore {
  readonly score: number;
  readonly breakdown: TrustBreakdown;
}

export const DEFAULT_DETECTOR_THRESHOLD = 65; // composite score above this trips the flag

export function computeTrustScore(inputs: TrustInputs): TrustScore {
  const threshold = inputs.detectorThreshold ?? DEFAULT_DETECTOR_THRESHOLD;
  const breakdown: TrustBreakdown = {
    disclosure: {
      passed: inputs.hasDisclosure,
      weight: 40,
      reason: inputs.hasDisclosure
        ? `Author attested at level "${inputs.disclosureLevel ?? 'unknown'}".`
        : 'No structured AI-use disclosure recorded.',
    },
    detector: {
      passed: detectorPasses(inputs, threshold),
      weight: 20,
      reason: detectorReason(inputs, threshold),
    },
    orcidVerified: {
      passed: inputs.hasAnyOrcid,
      weight: 20,
      reason: inputs.hasAnyOrcid
        ? 'At least one author published with an ORCID iD.'
        : 'No author has an ORCID iD attached.',
    },
    plainSummary: {
      passed: inputs.hasPlainSummary,
      weight: 20,
      reason: inputs.hasPlainSummary
        ? 'A plain-language summary is available.'
        : 'No plain-language summary was supplied.',
    },
  };

  let score = 0;
  if (breakdown.disclosure.passed) score += breakdown.disclosure.weight;
  if (breakdown.detector.passed) score += breakdown.detector.weight;
  if (breakdown.orcidVerified.passed) score += breakdown.orcidVerified.weight;
  if (breakdown.plainSummary.passed) score += breakdown.plainSummary.weight;

  return { score, breakdown };
}

function detectorPasses(inputs: TrustInputs, threshold: number): boolean {
  // Detector only runs when author claimed "no AI". For other levels, the
  // disclosure already covered it — give the point.
  if (inputs.disclosureLevel && inputs.disclosureLevel !== 'none') return true;
  // No disclosure or "none" without a detector score → cannot confirm.
  if (inputs.detectorScore === null) return false;
  return inputs.detectorScore < threshold;
}

function detectorReason(inputs: TrustInputs, threshold: number): string {
  if (inputs.disclosureLevel && inputs.disclosureLevel !== 'none') {
    return 'Detector skipped — author disclosed AI use.';
  }
  if (inputs.detectorScore === null) {
    return 'Undisclosed-AI detector has not produced a score yet.';
  }
  if (inputs.detectorScore < threshold) {
    return `Detector composite ${inputs.detectorScore} below threshold ${threshold}.`;
  }
  return `Detector composite ${inputs.detectorScore} above threshold ${threshold} — soft flag.`;
}

// ---------- Feed ranking ----------

export interface FeedScoreInputs {
  readonly ageDays: number;
  readonly semanticSimilarity: number; // 0..1, 0 when no viewer profile
  readonly trustVectorReadiness: number; // 0..1, derived from Passport lane states
  readonly blockedLaneCount: number;
  readonly unresolvedDisputeCount: number;
}

export interface TrustVectorReadiness {
  readonly readiness: number;
  readonly blockedLaneCount: number;
  readonly unresolvedDisputeCount: number;
}

/**
 * Vector-weighted feed ranking:
 *   rank = 0.45 * recency + 0.25 * semantic + 0.20 * passport_vector + 0.10 * dispute_clean
 *
 * - recency: exponential decay, half-life 7 days. Future timestamps are
 *   treated as "now" (clock skew safety — otherwise exp(positive) explodes).
 * - semantic: as supplied (cosine sim to viewer profile, or 0).
 * - passport_vector: lane-state readiness with a blocked-lane penalty.
 * - dispute_clean: lowered when unresolved public Passport disputes exist.
 */
export function computeFeedScore(inputs: FeedScoreInputs): number {
  const safeAge = Number.isFinite(inputs.ageDays) ? Math.max(0, inputs.ageDays) : 9999;
  const recency = Math.exp(-safeAge / 7);
  const semantic = clamp01(inputs.semanticSimilarity);
  const blocked = Math.max(0, Math.floor(inputs.blockedLaneCount));
  const disputeCount = Math.max(0, Math.floor(inputs.unresolvedDisputeCount));
  const blockedPenalty = Math.max(0.35, 1 - blocked * 0.12);
  const passportVector = clamp01(inputs.trustVectorReadiness) * blockedPenalty;
  const disputeClean = disputeCount === 0 ? 1 : 1 / (1 + disputeCount);
  return 0.45 * recency + 0.25 * semantic + 0.2 * passportVector + 0.1 * disputeClean;
}

const LANE_STATE_READINESS: Record<TrustLaneState, number> = {
  strong: 1,
  partial: 0.58,
  pending: 0.35,
  absent: 0,
};

const ISSUE_READINESS: Record<TrustIssueLevel, number> = {
  none: 1,
  watch: 0.9,
  'needs-work': 0.72,
  blocked: 0.45,
};

export function computeTrustVectorReadiness(
  passport: Pick<TrustPassport, TrustPassportLaneKey>,
): TrustVectorReadiness {
  let readiness = 0;
  let blockedLaneCount = 0;

  for (const lane of TRUST_PASSPORT_LANES) {
    const evidence = passport[lane];
    readiness += LANE_STATE_READINESS[evidence.state] * ISSUE_READINESS[evidence.issueLevel];
    if (evidence.issueLevel === 'blocked') blockedLaneCount += 1;
  }

  return {
    readiness: clamp01(readiness / TRUST_PASSPORT_LANES.length),
    blockedLaneCount,
    unresolvedDisputeCount: 0,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
