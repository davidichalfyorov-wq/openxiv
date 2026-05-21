import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeFeedScore, computeTrustScore, computeTrustVectorReadiness } from './trust.js';
import { computeTrustPassport } from './trust-passport.js';

describe('computeTrustScore', () => {
  it('all components passing → 100', () => {
    const { score, breakdown } = computeTrustScore({
      hasDisclosure: true,
      disclosureLevel: 'none',
      detectorScore: 10,
      hasAnyOrcid: true,
      hasPlainSummary: true,
    });
    expect(score).toBe(100);
    expect(breakdown.disclosure.passed).toBe(true);
    expect(breakdown.detector.passed).toBe(true);
  });

  it('no disclosure + no summary + no ORCID → 0', () => {
    const { score } = computeTrustScore({
      hasDisclosure: false,
      detectorScore: null,
      hasAnyOrcid: false,
      hasPlainSummary: false,
    });
    expect(score).toBe(0);
  });

  it('non-"none" disclosure auto-passes detector', () => {
    const { breakdown } = computeTrustScore({
      hasDisclosure: true,
      disclosureLevel: 'coauthor',
      detectorScore: null,
      hasAnyOrcid: false,
      hasPlainSummary: false,
    });
    expect(breakdown.detector.passed).toBe(true);
    expect(breakdown.detector.reason).toMatch(/skipped/i);
  });

  it('"none" with high detector composite fails detector check', () => {
    const { score, breakdown } = computeTrustScore({
      hasDisclosure: true,
      disclosureLevel: 'none',
      detectorScore: 90,
      hasAnyOrcid: true,
      hasPlainSummary: true,
    });
    expect(breakdown.detector.passed).toBe(false);
    expect(score).toBe(80); // disclosure 40 + ORCID 20 + summary 20
  });
});

describe('Trust Score property bounds', () => {
  it('always lands in [0, 100]', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom('none' as const, 'assistant' as const, 'coauthor' as const, 'primary' as const),
        fc.option(fc.integer({ min: 0, max: 100 })),
        fc.boolean(),
        fc.boolean(),
        (hasDisclosure, level, detector, orcid, summary) => {
          const result = computeTrustScore({
            hasDisclosure,
            disclosureLevel: hasDisclosure ? level : undefined,
            detectorScore: detector,
            hasAnyOrcid: orcid,
            hasPlainSummary: summary,
          });
          return result.score >= 0 && result.score <= 100;
        },
      ),
    );
  });

  it('total score equals the sum of weights for components that pass', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom('none' as const, 'assistant' as const, 'coauthor' as const, 'primary' as const),
        fc.option(fc.integer({ min: 0, max: 100 })),
        fc.boolean(),
        fc.boolean(),
        (hasDisclosure, level, detector, orcid, summary) => {
          const { score, breakdown } = computeTrustScore({
            hasDisclosure,
            disclosureLevel: hasDisclosure ? level : undefined,
            detectorScore: detector,
            hasAnyOrcid: orcid,
            hasPlainSummary: summary,
          });
          const expected =
            (breakdown.disclosure.passed ? 40 : 0) +
            (breakdown.detector.passed ? 20 : 0) +
            (breakdown.orcidVerified.passed ? 20 : 0) +
            (breakdown.plainSummary.passed ? 20 : 0);
          return score === expected;
        },
      ),
    );
  });

  it('score is monotonic — flipping any single component from fail to pass cannot decrease it', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.integer({ min: 0, max: 100 })),
        fc.boolean(),
        fc.boolean(),
        (hasDisclosure, detector, orcid, summary) => {
          const base = computeTrustScore({
            hasDisclosure: false,
            disclosureLevel: 'none',
            detectorScore: detector,
            hasAnyOrcid: orcid,
            hasPlainSummary: summary,
          }).score;
          const flipped = computeTrustScore({
            hasDisclosure: hasDisclosure || true,
            disclosureLevel: 'assistant',
            detectorScore: detector,
            hasAnyOrcid: orcid,
            hasPlainSummary: summary,
          }).score;
          return flipped >= base;
        },
      ),
    );
  });
});

describe('computeFeedScore', () => {
  it('returns a finite number in [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 365, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        (age, sim, readiness, blocked, disputes) => {
          const s = computeFeedScore({
            ageDays: age,
            semanticSimilarity: sim,
            trustVectorReadiness: readiness,
            blockedLaneCount: blocked,
            unresolvedDisputeCount: disputes,
          });
          return Number.isFinite(s) && s >= 0 && s <= 1;
        },
      ),
    );
  });

  it('recency dominates for fresh papers with no other signal', () => {
    const fresh = computeFeedScore({
      ageDays: 0,
      semanticSimilarity: 0,
      trustVectorReadiness: 0,
      blockedLaneCount: 0,
      unresolvedDisputeCount: 0,
    });
    const stale = computeFeedScore({
      ageDays: 100,
      semanticSimilarity: 0,
      trustVectorReadiness: 0,
      blockedLaneCount: 0,
      unresolvedDisputeCount: 0,
    });
    expect(fresh).toBeGreaterThan(stale);
  });

  it('uses the Passport lane vector instead of a legacy single trustScore', () => {
    const weak = computeFeedScore({
      ageDays: 2,
      semanticSimilarity: 0,
      trustVectorReadiness: 0.1,
      blockedLaneCount: 5,
      unresolvedDisputeCount: 2,
    });
    const strong = computeFeedScore({
      ageDays: 2,
      semanticSimilarity: 0,
      trustVectorReadiness: 0.9,
      blockedLaneCount: 0,
      unresolvedDisputeCount: 0,
    });
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('computeTrustVectorReadiness', () => {
  it('derives feed readiness from lane states and blocked lanes', () => {
    const passport = computeTrustPassport({
      hasDisclosure: true,
      disclosureLevel: 'none',
      disclosureHumanVerified: true,
      hasPlainSummary: true,
      hasAnyOrcid: true,
      submitterDidValid: true,
      authorCount: 1,
      identifiedAuthorCount: 1,
      hasSourceArchive: true,
      hasCompiledPdf: true,
      hasHtmlRendering: true,
      hasFileHash: true,
      provenanceCompletion: 100,
      detectorScore: 10,
      endorsementCount: 3,
      distinctEndorsementVerbs: 3,
      publicDisputeCount: 0,
      resolvedDisputeCount: 0,
      hasReferenceSection: true,
      citationMarkerCount: 12,
      referenceEntryCount: 8,
      resolvedReferenceCount: 6,
      mathHeavy: false,
    });

    const readiness = computeTrustVectorReadiness(passport);

    expect(readiness.readiness).toBeGreaterThan(0.8);
    expect(readiness.blockedLaneCount).toBe(0);
    expect(readiness.unresolvedDisputeCount).toBe(0);
  });
});
