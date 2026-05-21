import { describe, expect, it } from 'vitest';
import { computeTrustPassport } from '@openxiv/shared';
import { generateKeypair } from './user-keys.js';
import {
  buildTrustPassportJsonLd,
  signTrustPassportBundle,
  verifyTrustPassportBundle,
} from './trust-passport-bundle.js';

function sampleTrust() {
  return computeTrustPassport({
    hasDisclosure: true,
    disclosureLevel: 'none',
    hasPlainSummary: true,
    hasAnyOrcid: true,
    submitterDidValid: true,
    detectorScore: 12,
    endorsementCount: 3,
    distinctEndorsementVerbs: 2,
  });
}

describe('Trust Passport JSON-LD bundle', () => {
  it('serializes every lane as checks without exposing a single aggregate score', () => {
    const bundle = buildTrustPassportJsonLd({
      publicBase: 'https://openxiv.net',
      paperId: 'paper-uuid',
      openxivId: 'openxiv:gr-qc.2026.00001',
      openxivUrlId: 'gr-qc.2026.00001',
      title: 'A test paper',
      versionId: 'version-1',
      generatedAt: '2026-05-19T12:00:00.000Z',
      issuerDid: 'did:web:openxiv.net',
      trust: sampleTrust(),
      citationItems: [
        {
          label: 'Citation [3]',
          ref: '[3]',
          resolved: '10.1103/PhysRevLett.14.57',
          via: 'doi',
          confidence: 'high',
          passed: true,
          status: 'pass',
          note: 'Resolved via DOI in the reference entry.',
          weight: 1,
          value: 1,
          severity: 'info',
          source: 'pipeline',
        },
        {
          label: 'Citation [7]',
          ref: '[7]',
          resolved: null,
          via: 'unresolved',
          confidence: 'low',
          passed: false,
          status: 'fail',
          note: 'No DOI, arXiv id, or stable URL was found in the reference entry.',
          weight: 1,
          value: 0,
          severity: 'medium',
          source: 'pipeline',
          action: 'Fix citation [7].',
        },
      ],
      mathItems: [
        {
          label: 'Formula evidence 1',
          category: 'formula',
          section: 'Main proof',
          snippet: 'K = 96 M^2 / l^6',
          confidence: 'medium',
          passed: true,
          status: 'pass',
          note: 'Formula-like expression found in Main proof.',
          weight: 1,
          value: 1,
          severity: 'info',
          source: 'pipeline',
        },
      ],
      publicDisputes: [
        {
          id: 'dispute-1',
          uri: 'at://did:plc:reader/app.openxiv.post/1',
          lane: 'citations',
          authorDid: 'did:plc:reader',
          text: 'Citation [3] does not support claim section 2.1.',
          targetRef: 'citation [3]',
          status: 'open',
          createdAt: '2026-05-19T12:03:00.000Z',
        },
      ],
      publicDisputeResponses: [
        {
          id: 'response-1',
          uri: 'at://did:plc:author/app.openxiv.post/2',
          disputeId: 'dispute-1',
          disputeUri: 'at://did:plc:reader/app.openxiv.post/1',
          lane: 'citations',
          authorDid: 'did:plc:author',
          text: 'We will clarify citation [3] in the next version.',
          createdAt: '2026-05-19T12:04:00.000Z',
        },
      ],
      externalAttestations: [
        {
          id: 'attestation-1',
          uri: 'at://did:web:biorxiv.org/app.openxiv.post/3',
          issuer: 'did:web:biorxiv.org',
          publicKeyMultibase: 'zExtKey',
          lane: 'integrity',
          statement: 'We independently verified dataset integrity.',
          signature: 'sig',
          signatureVerified: true,
          verificationUrl: 'https://biorxiv.org/attestation/1',
          createdAt: '2026-05-19T12:02:00.000Z',
        },
      ],
    });

    expect(bundle['@context']).toContain('https://schema.org');
    expect(bundle.paper_id).toBe('openxiv:gr-qc.2026.00001');
    expect(bundle.checks.map((check) => check.lane)).toEqual([
      'transparency',
      'identity',
      'provenance',
      'citations',
      'math',
      'integrity',
      'socialReview',
    ]);
    expect(bundle.checks.find((check) => check.lane === 'citations')?.items).toEqual([
      expect.objectContaining({
        label: 'Citation [3]',
        ref: '[3]',
        resolved: '10.1103/PhysRevLett.14.57',
        via: 'doi',
        confidence: 'high',
      }),
      expect.objectContaining({
        label: 'Citation [7]',
        ref: '[7]',
        resolved: null,
        via: 'unresolved',
        confidence: 'low',
      }),
    ]);
    expect(bundle.checks.find((check) => check.lane === 'citations')?.summary).toEqual({
      passedItems: 1,
      attentionItems: 1,
      pendingItems: 0,
      notApplicableItems: 0,
      disputeCount: 1,
      unresolvedDisputeCount: 1,
      highlightedDisputeCount: 0,
      responseCount: 1,
      externalAttestationCount: 0,
      verifiedExternalAttestationCount: 0,
      unverifiedExternalAttestationCount: 0,
      historyState: 'answered_contestation',
      lastActivityAt: '2026-05-19T12:04:00.000Z',
      topAction: 'Respond to or resolve 1 open citations dispute.',
    });
    expect(bundle.checks.find((check) => check.lane === 'citations')).toMatchObject({
      status: 'yellow',
      issueLevel: 'needs-work',
      nextActions: expect.arrayContaining([
        'Respond to or resolve 1 open citations dispute.',
      ]),
    });
    expect(bundle.checks.find((check) => check.lane === 'integrity')?.summary).toMatchObject({
      externalAttestationCount: 1,
      verifiedExternalAttestationCount: 1,
      unverifiedExternalAttestationCount: 0,
      historyState: 'externally_attested',
      lastActivityAt: '2026-05-19T12:02:00.000Z',
    });
    expect(bundle.checks.find((check) => check.lane === 'integrity')?.summary).not.toMatchObject({
      topAction: 'Fix citation [7].',
    });
    expect(bundle.checks.find((check) => check.lane === 'math')?.items).toEqual([
      expect.objectContaining({
        label: 'Formula evidence 1',
        category: 'formula',
        section: 'Main proof',
        snippet: 'K = 96 M^2 / l^6',
        confidence: 'medium',
      }),
    ]);
    expect(bundle.history).toEqual([
      expect.objectContaining({
        id: 'attestation-1',
        type: 'external_attestation',
        lane: 'integrity',
        actorDid: 'did:web:biorxiv.org',
        statement: 'We independently verified dataset integrity.',
        signature: 'sig',
        signatureVerified: true,
      }),
      expect.objectContaining({
        id: 'dispute-1',
        type: 'public_dispute',
        lane: 'citations',
        actorDid: 'did:plc:reader',
        targetRef: 'citation [3]',
      }),
      expect.objectContaining({
        id: 'response-1',
        type: 'dispute_response',
        lane: 'citations',
        actorDid: 'did:plc:author',
        relatedId: 'dispute-1',
      }),
    ]);
    expect(bundle.publicDisputes).toHaveLength(1);
    expect(bundle.externalAttestations).toHaveLength(1);
    expect(bundle.checks.every((check) => !('score' in check))).toBe(true);
    expect(bundle.checks.every((check) => !('confidence' in check))).toBe(true);
    expect(JSON.stringify(bundle)).not.toMatch(
      /trustScore|transparencyScore|aggregateScore|"score"|"confidence":\d/i,
    );
  });

  it('lets highlighted lane disputes override an otherwise green lane without inventing a single score', () => {
    const bundle = buildTrustPassportJsonLd({
      publicBase: 'https://openxiv.net',
      paperId: 'paper-uuid',
      openxivId: 'openxiv:gr-qc.2026.00001',
      openxivUrlId: 'gr-qc.2026.00001',
      title: 'A test paper',
      versionId: 'version-1',
      generatedAt: '2026-05-19T12:00:00.000Z',
      issuerDid: 'did:web:openxiv.net',
      trust: computeTrustPassport({
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
        detectorScore: 12,
        endorsementCount: 3,
        distinctEndorsementVerbs: 3,
        hasReferenceSection: true,
        citationMarkerCount: 20,
        referenceEntryCount: 12,
        resolvedReferenceCount: 10,
        mathHeavy: false,
      }),
      publicDisputes: [
        {
          id: 'dispute-highlight',
          uri: 'at://did:plc:reader/app.openxiv.post/highlight',
          lane: 'citations',
          authorDid: 'did:plc:reader',
          text: 'Citation [3] is materially misleading.',
          targetRef: 'citation [3]',
          status: 'highlighted',
          createdAt: '2026-05-19T12:05:00.000Z',
        },
      ],
    });

    const citations = bundle.checks.find((check) => check.lane === 'citations');

    expect(citations).toMatchObject({
      status: 'red',
      issueLevel: 'blocked',
      summary: expect.objectContaining({
        highlightedDisputeCount: 1,
        unresolvedDisputeCount: 1,
        historyState: 'contested',
        topAction: 'Resolve 1 highlighted citations dispute.',
      }),
    });
    expect(citations).not.toHaveProperty('score');
  });

  it('surfaces verified external attestations as lane evidence even when OpenXiv checks are pending', () => {
    const bundle = buildTrustPassportJsonLd({
      publicBase: 'https://openxiv.net',
      paperId: 'paper-uuid',
      openxivId: 'openxiv:gr-qc.2026.00001',
      openxivUrlId: 'gr-qc.2026.00001',
      title: 'A test paper',
      versionId: 'version-1',
      generatedAt: '2026-05-19T12:00:00.000Z',
      issuerDid: 'did:web:openxiv.net',
      trust: sampleTrust(),
      externalAttestations: [
        {
          id: 'attestation-2',
          uri: 'at://did:web:journal.example/app.openxiv.post/4',
          issuer: 'did:web:journal.example',
          publicKeyMultibase: 'zExtKey',
          lane: 'citations',
          statement: 'Journal review verified reference integrity.',
          signature: 'sig',
          signatureVerified: true,
          verificationUrl: 'https://journal.example/review/4',
          createdAt: '2026-05-19T12:06:00.000Z',
        },
      ],
    });

    const citations = bundle.checks.find((check) => check.lane === 'citations');

    expect(citations).toMatchObject({
      status: 'yellow',
      issueLevel: 'watch',
      summary: expect.objectContaining({
        externalAttestationCount: 1,
        verifiedExternalAttestationCount: 1,
        historyState: 'externally_attested',
        lastActivityAt: '2026-05-19T12:06:00.000Z',
      }),
    });
  });

  it('signs canonical JSON-LD and rejects tampered bundles', () => {
    const keypair = generateKeypair();
    const unsigned = buildTrustPassportJsonLd({
      publicBase: 'https://openxiv.net',
      paperId: 'paper-uuid',
      openxivId: 'openxiv:gr-qc.2026.00001',
      openxivUrlId: 'gr-qc.2026.00001',
      title: 'A test paper',
      versionId: 'version-1',
      generatedAt: '2026-05-19T12:00:00.000Z',
      issuerDid: 'did:web:openxiv.net',
      trust: sampleTrust(),
    });

    const signed = signTrustPassportBundle(unsigned, keypair.privateKey, {
      created: '2026-05-19T12:00:01.000Z',
      verificationMethod: 'did:web:openxiv.net#atproto',
    });

    expect(signed.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(signed.proof).toMatchObject({
      type: 'EcdsaSecp256k1Signature2019',
      proofPurpose: 'assertionMethod',
      verificationMethod: 'did:web:openxiv.net#atproto',
    });
    expect(verifyTrustPassportBundle(signed, keypair.publicKey)).toBe(true);

    const tampered = {
      ...signed,
      checks: signed.checks.map((check, index) =>
        index === 0 ? { ...check, status: 'red' as const } : check,
      ),
    };
    expect(verifyTrustPassportBundle(tampered, keypair.publicKey)).toBe(false);
  });
});
