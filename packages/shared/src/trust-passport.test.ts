import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeTrustPassport, type TrustPassportInputs } from './trust-passport.js';

function base(over: Partial<TrustPassportInputs> = {}): TrustPassportInputs {
  return {
    hasDisclosure: false,
    disclosureLevel: undefined,
    disclosureHumanVerified: false,
    disclosedModelCount: 0,
    hasPlainSummary: false,
    hasAnyOrcid: false,
    submitterDidValid: false,
    authorCount: 0,
    identifiedAuthorCount: 0,
    hasSourceArchive: false,
    hasCompiledPdf: false,
    hasHtmlRendering: false,
    hasFileHash: false,
    provenanceCompletion: null,
    detectorScore: null,
    endorsementCount: 0,
    distinctEndorsementVerbs: 0,
    publicDisputeCount: 0,
    resolvedDisputeCount: 0,
    hasReferenceSection: null,
    citationMarkerCount: null,
    referenceEntryCount: null,
    resolvedReferenceCount: null,
    mathHeavy: null,
    mathExpressionCount: null,
    theoremLikeCount: null,
    ...over,
  };
}

describe('computeTrustPassport', () => {
  it('returns seven deterministic evidence lanes plus the legacy compatibility score', () => {
    const p = computeTrustPassport(base());
    expect(Object.keys(p).sort()).toEqual([
      'citations',
      'identity',
      'integrity',
      'math',
      'provenance',
      'socialReview',
      'transparency',
      'transparencyScore',
    ]);
    for (const lane of [
      p.transparency,
      p.identity,
      p.provenance,
      p.citations,
      p.math,
      p.integrity,
      p.socialReview,
    ]) {
      expect(lane).toHaveProperty('confidence');
      expect(lane).toHaveProperty('issueLevel');
      expect(lane).toHaveProperty('nextActions');
    }
  });

  it('each lane score and confidence is in [0,100]', () => {
    fc.assert(
      fc.property(
        fc.record({
          hasDisclosure: fc.boolean(),
          level: fc.constantFrom(undefined, 'none' as const, 'assistant' as const, 'coauthor' as const, 'primary' as const),
          humanVerified: fc.boolean(),
          modelCount: fc.integer({ min: 0, max: 5 }),
          hasPlainSummary: fc.boolean(),
          hasAnyOrcid: fc.boolean(),
          submitterDidValid: fc.boolean(),
          authorCount: fc.integer({ min: 0, max: 20 }),
          identifiedAuthors: fc.integer({ min: 0, max: 20 }),
          hasSourceArchive: fc.boolean(),
          hasCompiledPdf: fc.boolean(),
          hasHtmlRendering: fc.boolean(),
          hasFileHash: fc.boolean(),
          provenanceCompletion: fc.option(fc.integer({ min: 0, max: 100 })),
          detectorScore: fc.option(fc.integer({ min: 0, max: 100 })),
          endorsementCount: fc.integer({ min: 0, max: 100 }),
          distinctVerbs: fc.integer({ min: 0, max: 6 }),
          disputes: fc.integer({ min: 0, max: 10 }),
          resolved: fc.integer({ min: 0, max: 10 }),
          hasReferenceSection: fc.option(fc.boolean()),
          citationMarkers: fc.option(fc.integer({ min: 0, max: 50 })),
          referenceEntries: fc.option(fc.integer({ min: 0, max: 50 })),
          resolvedReferences: fc.option(fc.integer({ min: 0, max: 50 })),
          mathHeavy: fc.option(fc.boolean()),
          mathExpressions: fc.option(fc.integer({ min: 0, max: 80 })),
          theoremLike: fc.option(fc.integer({ min: 0, max: 20 })),
        }),
        (r) => {
          const p = computeTrustPassport(
            base({
              hasDisclosure: r.hasDisclosure,
              disclosureLevel: r.level,
              disclosureHumanVerified: r.humanVerified,
              disclosedModelCount: r.modelCount,
              hasPlainSummary: r.hasPlainSummary,
              hasAnyOrcid: r.hasAnyOrcid,
              submitterDidValid: r.submitterDidValid,
              authorCount: r.authorCount,
              identifiedAuthorCount: r.identifiedAuthors,
              hasSourceArchive: r.hasSourceArchive,
              hasCompiledPdf: r.hasCompiledPdf,
              hasHtmlRendering: r.hasHtmlRendering,
              hasFileHash: r.hasFileHash,
              provenanceCompletion: r.provenanceCompletion,
              detectorScore: r.detectorScore,
              endorsementCount: r.endorsementCount,
              distinctEndorsementVerbs: r.distinctVerbs,
              publicDisputeCount: r.disputes,
              resolvedDisputeCount: r.resolved,
              hasReferenceSection: r.hasReferenceSection,
              citationMarkerCount: r.citationMarkers,
              referenceEntryCount: r.referenceEntries,
              resolvedReferenceCount: r.resolvedReferences,
              mathHeavy: r.mathHeavy,
              mathExpressionCount: r.mathExpressions,
              theoremLikeCount: r.theoremLike,
            }),
          );
          for (const lane of [
            p.transparency,
            p.identity,
            p.provenance,
            p.citations,
            p.math,
            p.integrity,
            p.socialReview,
          ]) {
            if (lane.score < 0 || lane.score > 100) return false;
            if (lane.confidence < 0 || lane.confidence > 100) return false;
          }
          return p.transparencyScore >= 0 && p.transparencyScore <= 100;
        },
      ),
    );
  });

  it('transparency is strong only when disclosure, level, human verification, and summary are present', () => {
    const complete = computeTrustPassport(
      base({
        hasDisclosure: true,
        disclosureLevel: 'none',
        disclosureHumanVerified: true,
        hasPlainSummary: true,
      }),
    ).transparency;
    expect(complete.state).toBe('strong');
    expect(complete.score).toBe(100);
    expect(complete.issueLevel).toBe('none');

    const missingAttestation = computeTrustPassport(
      base({ hasDisclosure: true, disclosureLevel: 'none', hasPlainSummary: true }),
    ).transparency;
    expect(missingAttestation.state).toBe('partial');
    expect(missingAttestation.issueLevel).toBe('blocked');
    expect(missingAttestation.nextActions).toContain('Add the human verification attestation.');
  });

  it('AI-assistance disclosure requires model names instead of treating disclosure as sufficient', () => {
    const missingModels = computeTrustPassport(
      base({
        hasDisclosure: true,
        disclosureLevel: 'assistant',
        disclosureHumanVerified: true,
        hasPlainSummary: true,
        disclosedModelCount: 0,
      }),
    ).transparency;
    expect(missingModels.state).toBe('partial');
    expect(missingModels.nextActions).toContain('Name every AI model that materially contributed.');

    const namedModels = computeTrustPassport(
      base({
        hasDisclosure: true,
        disclosureLevel: 'assistant',
        disclosureHumanVerified: true,
        hasPlainSummary: true,
        disclosedModelCount: 2,
      }),
    ).transparency;
    expect(namedModels.state).toBe('strong');
  });

  it('identity uses coverage, not just one ORCID plus one DID', () => {
    const partialCoverage = computeTrustPassport(
      base({
        hasAnyOrcid: true,
        submitterDidValid: true,
        authorCount: 4,
        identifiedAuthorCount: 1,
      }),
    ).identity;
    expect(partialCoverage.state).toBe('partial');
    expect(partialCoverage.score).toBeLessThan(80);
    expect(partialCoverage.nextActions).toContain('Attach ORCID or DID evidence to every author row.');

    const fullCoverage = computeTrustPassport(
      base({
        hasAnyOrcid: true,
        submitterDidValid: true,
        authorCount: 2,
        identifiedAuthorCount: 2,
      }),
    ).identity;
    expect(fullCoverage.state).toBe('strong');
  });

  it('provenance rewards rebuildable source, rendered artifacts, hashes, and lifecycle completion', () => {
    const p = computeTrustPassport(
      base({
        hasSourceArchive: true,
        hasCompiledPdf: true,
        hasHtmlRendering: true,
        hasFileHash: true,
        provenanceCompletion: 100,
      }),
    ).provenance;
    expect(p.state).toBe('strong');
    expect(p.score).toBe(100);

    const missingSource = computeTrustPassport(
      base({
        hasCompiledPdf: true,
        hasHtmlRendering: true,
        hasFileHash: true,
        provenanceCompletion: 100,
      }),
    ).provenance;
    expect(missingSource.state).not.toBe('strong');
    expect(missingSource.issueLevel).toBe('blocked');
  });

  it('citations rewards reference sections, in-text markers, and resolvable references', () => {
    const strong = computeTrustPassport(
      base({
        hasReferenceSection: true,
        citationMarkerCount: 14,
        referenceEntryCount: 9,
        resolvedReferenceCount: 7,
      }),
    ).citations;
    expect(strong.state).toBe('strong');
    expect(strong.score).toBeGreaterThanOrEqual(90);
    expect(strong.checks.map((check) => check.label)).toEqual([
      'Reference section detected',
      'In-text citation markers',
      'Reference entries extracted',
      'Resolvable reference identifiers',
    ]);

    const absent = computeTrustPassport(
      base({
        hasReferenceSection: false,
        citationMarkerCount: 0,
        referenceEntryCount: 0,
        resolvedReferenceCount: 0,
      }),
    ).citations;
    expect(absent.state).toBe('absent');
    expect(absent.issueLevel).toBe('blocked');
    expect(absent.nextActions).toContain('Add or repair a References/Bibliography section.');
  });

  it('math is strong for math-heavy papers with formula and proof evidence, but neutral for non-math papers', () => {
    const strong = computeTrustPassport(
      base({
        mathHeavy: true,
        mathExpressionCount: 18,
        theoremLikeCount: 5,
        hasSourceArchive: true,
        disclosureHumanVerified: true,
      }),
    ).math;
    expect(strong.state).toBe('strong');
    expect(strong.score).toBe(100);
    expect(strong.checks.map((check) => check.label)).toEqual([
      'Math-heavy content detected',
      'Formula density',
      'Formal statement/proof structure',
      'Source available for formula audit',
      'Human math verification attested',
    ]);

    const nonMath = computeTrustPassport(
      base({ mathHeavy: false, mathExpressionCount: 0, theoremLikeCount: 0 }),
    ).math;
    expect(nonMath.state).toBe('strong');
    expect(nonMath.checks.every((check) => check.status === 'not_applicable')).toBe(true);
  });

  it('math stays pending when no text extraction evidence exists yet', () => {
    const p = computeTrustPassport(base()).math;
    expect(p.state).toBe('pending');
    expect(p.nextActions).toContain('Run text extraction before judging mathematical auditability.');
  });

  it('integrity does not become strong merely because AI use was disclosed', () => {
    const p = computeTrustPassport(
      base({ disclosureLevel: 'coauthor', hasDisclosure: true }),
    ).integrity;
    expect(p.state).toBe('absent');
    expect(p.nextActions).toContain('Attach or recover the source archive.');
  });

  it('integrity is strong when source, hash, human attestation, and detector evidence line up', () => {
    const p = computeTrustPassport(
      base({
        hasDisclosure: true,
        disclosureLevel: 'none',
        disclosureHumanVerified: true,
        hasSourceArchive: true,
        hasFileHash: true,
        detectorScore: 10,
      }),
    ).integrity;
    expect(p.state).toBe('strong');
  });

  it('integrity is absent when detector trips above threshold despite other artifacts', () => {
    const p = computeTrustPassport(
      base({
        hasDisclosure: true,
        disclosureLevel: 'none',
        disclosureHumanVerified: true,
        hasSourceArchive: true,
        hasFileHash: true,
        detectorScore: 90,
      }),
    ).integrity;
    expect(p.state).toBe('partial');
    expect(p.issueLevel).toBe('blocked');
  });

  it('social review stays pending when there is no community evidence at all', () => {
    const p = computeTrustPassport(base()).socialReview;
    expect(p.state).toBe('pending');
  });

  it('social review uses typed endorsement depth and unresolved disputes', () => {
    const shallow = computeTrustPassport(
      base({ endorsementCount: 1, distinctEndorsementVerbs: 1 }),
    ).socialReview;
    expect(shallow.state).toBe('partial');

    const disputed = computeTrustPassport(
      base({
        endorsementCount: 5,
        distinctEndorsementVerbs: 3,
        publicDisputeCount: 2,
        resolvedDisputeCount: 0,
      }),
    ).socialReview;
    expect(disputed.state).not.toBe('strong');
    expect(disputed.issueLevel).toBe('blocked');

    const resolved = computeTrustPassport(
      base({
        endorsementCount: 5,
        distinctEndorsementVerbs: 3,
        publicDisputeCount: 2,
        resolvedDisputeCount: 2,
      }),
    ).socialReview;
    expect(resolved.state).toBe('strong');
  });

  it('legacy transparencyScore is the mean of the seven lane scores', () => {
    fc.assert(
      fc.property(
        fc.record({
          hasDisclosure: fc.boolean(),
          level: fc.constantFrom(undefined, 'none' as const, 'assistant' as const, 'coauthor' as const, 'primary' as const),
          hasPlainSummary: fc.boolean(),
          hasAnyOrcid: fc.boolean(),
          submitterDidValid: fc.boolean(),
          detectorScore: fc.option(fc.integer({ min: 0, max: 100 })),
          endorsementCount: fc.integer({ min: 0, max: 100 }),
          distinctVerbs: fc.integer({ min: 0, max: 6 }),
        }),
        (r) => {
          const p = computeTrustPassport(
            base({
              hasDisclosure: r.hasDisclosure,
              disclosureLevel: r.level,
              hasPlainSummary: r.hasPlainSummary,
              hasAnyOrcid: r.hasAnyOrcid,
              submitterDidValid: r.submitterDidValid,
              detectorScore: r.detectorScore,
              endorsementCount: r.endorsementCount,
              distinctEndorsementVerbs: r.distinctVerbs,
            }),
          );
          const mean = Math.round(
            (p.transparency.score +
              p.identity.score +
              p.provenance.score +
              p.citations.score +
              p.math.score +
              p.integrity.score +
              p.socialReview.score) /
              7,
          );
          return p.transparencyScore === mean;
        },
      ),
    );
  });
});
