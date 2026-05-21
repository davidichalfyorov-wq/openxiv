/**
 * Trust Passport is a vector of evidence lanes, not a verdict and not a
 * popularity score. The assignment algorithm below is intentionally
 * evidence-weighted:
 *
 * - score answers "how much of the lane's current evidence is satisfied?"
 * - confidence answers "how much evidence was actually observed vs pending?"
 * - issueLevel/nextActions explain why a lane is not green.
 *
 * `transparencyScore` remains only as a legacy compatibility field for old
 * consumers; signed JSON-LD Passport artifacts omit it.
 */

export type TrustLaneState = 'strong' | 'partial' | 'absent' | 'pending';
export type TrustCheckStatus = 'pass' | 'fail' | 'pending' | 'not_applicable';
export type TrustCheckSeverity = 'info' | 'low' | 'medium' | 'high';
export type TrustCheckSource = 'author' | 'pipeline' | 'identity' | 'community';
export type TrustIssueLevel = 'none' | 'watch' | 'needs-work' | 'blocked';

export interface TrustCheck {
  readonly label: string;
  readonly passed: boolean;
  readonly status: TrustCheckStatus;
  readonly note: string;
  readonly weight: number;
  readonly value: number | null;
  readonly severity: TrustCheckSeverity;
  readonly source: TrustCheckSource;
  readonly action?: string;
}

export interface TrustLane {
  readonly state: TrustLaneState;
  readonly score: number; // 0..100, per-lane only
  readonly confidence: number; // 0..100
  readonly issueLevel: TrustIssueLevel;
  readonly checks: ReadonlyArray<TrustCheck>;
  readonly nextActions: ReadonlyArray<string>;
}

export interface TrustPassport {
  readonly transparency: TrustLane;
  readonly identity: TrustLane;
  readonly provenance: TrustLane;
  readonly citations: TrustLane;
  readonly math: TrustLane;
  readonly integrity: TrustLane;
  readonly socialReview: TrustLane;
  /** Legacy mean of lane scores; not shown in signed Passport JSON-LD. */
  readonly transparencyScore: number;
}

export interface TrustPassportInputs {
  readonly hasDisclosure: boolean;
  readonly disclosureLevel?: 'none' | 'assistant' | 'coauthor' | 'primary' | undefined;
  readonly disclosureHumanVerified?: boolean;
  readonly disclosedModelCount?: number;
  readonly hasPlainSummary: boolean;

  readonly hasAnyOrcid: boolean;
  /** Whether the submitter's DID looks valid (`did:plc:` / `did:web:`). */
  readonly submitterDidValid: boolean;
  readonly authorCount?: number;
  readonly identifiedAuthorCount?: number;

  readonly hasSourceArchive?: boolean;
  readonly hasCompiledPdf?: boolean;
  readonly hasHtmlRendering?: boolean;
  readonly hasFileHash?: boolean;
  readonly provenanceCompletion?: number | null;

  /** Detector composite score, or null if not yet scored. */
  readonly detectorScore: number | null;
  readonly detectorThreshold?: number;

  /** Total typed endorsements on the paper. */
  readonly endorsementCount: number;
  /** Number of distinct endorsement verbs (e.g. verified_derivation + reproduced_result). */
  readonly distinctEndorsementVerbs: number;
  readonly publicDisputeCount?: number;
  readonly resolvedDisputeCount?: number;

  /** Whether text extraction observed a References/Bibliography section; null means not extracted yet. */
  readonly hasReferenceSection?: boolean | null;
  readonly citationMarkerCount?: number | null;
  readonly referenceEntryCount?: number | null;
  readonly resolvedReferenceCount?: number | null;

  /** Whether indexed content looks math-heavy; null means text extraction has not produced evidence yet. */
  readonly mathHeavy?: boolean | null;
  readonly mathExpressionCount?: number | null;
  readonly theoremLikeCount?: number | null;
}

interface EvidenceSignal {
  readonly label: string;
  readonly value: number | null;
  readonly status?: TrustCheckStatus;
  readonly weight: number;
  readonly severity: TrustCheckSeverity;
  readonly source: TrustCheckSource;
  readonly note: string;
  readonly action?: string;
}

const DEFAULT_DETECTOR_THRESHOLD = 65;
export const TRUST_PASSPORT_LANES = [
  'transparency',
  'identity',
  'provenance',
  'citations',
  'math',
  'integrity',
  'socialReview',
] as const;
export type TrustPassportLaneKey = (typeof TRUST_PASSPORT_LANES)[number];

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function boolSignal(input: Omit<EvidenceSignal, 'value'> & { passed: boolean }): EvidenceSignal {
  return { ...input, value: input.passed ? 1 : 0, status: input.passed ? 'pass' : 'fail' };
}

function pendingSignal(input: Omit<EvidenceSignal, 'value' | 'status'>): EvidenceSignal {
  return { ...input, value: null, status: 'pending' };
}

function notApplicableSignal(input: Omit<EvidenceSignal, 'value' | 'status'>): EvidenceSignal {
  return { ...input, value: null, status: 'not_applicable' };
}

function coverageSignal(input: Omit<EvidenceSignal, 'status'>): EvidenceSignal {
  const value = input.value === null ? null : clamp01(input.value);
  return {
    ...input,
    value,
    status: value === null ? 'pending' : value >= 0.999 ? 'pass' : 'fail',
  };
}

function evaluateLane(
  signals: EvidenceSignal[],
  opts: { pendingWhenNoEvidence?: boolean } = {},
): TrustLane {
  const checks: TrustCheck[] = signals.map((s) => {
    const status =
      s.status ??
      (s.value === null ? 'pending' : s.value >= 0.999 ? 'pass' : 'fail');
    return {
      label: s.label,
      passed: status === 'pass' || status === 'not_applicable',
      status,
      note: s.note,
      weight: s.weight,
      value: s.value,
      severity: s.severity,
      source: s.source,
      ...(s.action ? { action: s.action } : {}),
    };
  });

  const applicable = checks.filter((c) => c.status !== 'not_applicable');
  const possible = applicable.reduce((sum, c) => sum + c.weight, 0);
  const observed = applicable.filter((c) => c.status !== 'pending');
  const observedWeight = observed.reduce((sum, c) => sum + c.weight, 0);
  const positiveWeight = observed.reduce(
    (sum, c) => sum + c.weight * clamp01(c.value ?? 0),
    0,
  );
  const score = possible > 0 ? Math.round((positiveWeight / possible) * 100) : 100;
  const confidence = possible > 0 ? Math.round((observedWeight / possible) * 100) : 100;

  const failed = observed.filter((c) => (c.value ?? 0) < 0.999);
  const pending = applicable.filter((c) => c.status === 'pending');
  const hasHighFail = failed.some((c) => c.severity === 'high');
  const hasMediumFail = failed.some((c) => c.severity === 'medium');

  let state: TrustLaneState;
  if (applicable.length === 0 && checks.length > 0) {
    state = 'strong';
  } else if (
    observed.length === 0 ||
    (opts.pendingWhenNoEvidence && observed.length > 0 && positiveWeight === 0)
  ) {
    state = 'pending';
  } else if (hasHighFail && score < 55 && confidence >= 50) {
    state = 'absent';
  } else if (score >= 80 && confidence >= 70 && !hasHighFail) {
    state = 'strong';
  } else if (score >= 25 || confidence < 70) {
    state = 'partial';
  } else {
    state = 'absent';
  }

  const issueLevel: TrustIssueLevel =
    hasHighFail ? 'blocked' : hasMediumFail ? 'needs-work' : pending.length > 0 ? 'watch' : 'none';
  const nextActions = Array.from(
    new Set(
      [...failed, ...pending]
        .map((c) => c.action)
        .filter((a): a is string => Boolean(a)),
    ),
  ).slice(0, 4);

  return { state, score, confidence, issueLevel, checks, nextActions };
}

export function computeTrustPassport(inputs: TrustPassportInputs): TrustPassport {
  const threshold = inputs.detectorThreshold ?? DEFAULT_DETECTOR_THRESHOLD;
  const authorCount = Math.max(0, inputs.authorCount ?? (inputs.hasAnyOrcid ? 1 : 0));
  const identifiedAuthors = Math.max(
    0,
    Math.min(authorCount || 0, inputs.identifiedAuthorCount ?? (inputs.hasAnyOrcid ? 1 : 0)),
  );
  const identityCoverage = authorCount > 0 ? identifiedAuthors / authorCount : null;
  const aiDeclared =
    inputs.disclosureLevel === 'assistant' ||
    inputs.disclosureLevel === 'coauthor' ||
    inputs.disclosureLevel === 'primary';

  const transparency = evaluateLane([
    boolSignal({
      label: 'Structured AI-use disclosure',
      passed: inputs.hasDisclosure,
      weight: 0.3,
      severity: 'high',
      source: 'author',
      note: inputs.hasDisclosure
        ? 'Author submitted the formal AI-use questionnaire.'
        : 'No structured disclosure recorded.',
      action: 'Submit the structured AI-use disclosure.',
    }),
    boolSignal({
      label: 'Disclosure level specified',
      passed: Boolean(inputs.disclosureLevel),
      weight: 0.2,
      severity: 'high',
      source: 'author',
      note: inputs.disclosureLevel
        ? `Level: ${inputs.disclosureLevel}.`
        : 'No concrete level (none/assistant/coauthor/primary) recorded.',
      action: 'Choose none, assistant, coauthor, or primary for AI involvement.',
    }),
    aiDeclared
      ? boolSignal({
          label: 'AI models named',
          passed: (inputs.disclosedModelCount ?? 0) > 0,
          weight: 0.2,
          severity: 'high',
          source: 'author',
          note:
            (inputs.disclosedModelCount ?? 0) > 0
              ? `${inputs.disclosedModelCount} model${inputs.disclosedModelCount === 1 ? '' : 's'} listed.`
              : 'AI use is declared, but no model is named.',
          action: 'Name every AI model that materially contributed.',
        })
      : notApplicableSignal({
          label: 'AI models named',
          weight: 0.2,
          severity: 'info',
          source: 'author',
          note: 'Not applicable when the disclosure level is none.',
        }),
    boolSignal({
      label: 'Human verification attested',
      passed: Boolean(inputs.disclosureHumanVerified),
      weight: 0.15,
      severity: 'high',
      source: 'author',
      note: inputs.disclosureHumanVerified
        ? 'Author attested that claims, citations, and numbers were human-verified.'
        : 'No human verification attestation is recorded.',
      action: 'Add the human verification attestation.',
    }),
    boolSignal({
      label: 'Plain-language summary',
      passed: inputs.hasPlainSummary,
      weight: 0.15,
      severity: 'low',
      source: 'pipeline',
      note: inputs.hasPlainSummary
        ? 'A plain summary is available.'
        : 'No plain-language summary supplied or generated.',
      action: 'Provide or generate a readable summary.',
    }),
  ]);

  const identity = evaluateLane([
    boolSignal({
      label: 'Submitter DID parses as resolvable',
      passed: inputs.submitterDidValid,
      weight: 0.25,
      severity: 'high',
      source: 'identity',
      note: inputs.submitterDidValid
        ? 'Submitter signs with a did:plc or did:web identity.'
        : 'Submitter DID could not be parsed.',
      action: 'Publish under a valid did:plc or did:web identity.',
    }),
    boolSignal({
      label: 'At least one ORCID-identified author',
      passed: inputs.hasAnyOrcid,
      weight: 0.3,
      severity: 'medium',
      source: 'identity',
      note: inputs.hasAnyOrcid
        ? 'One or more authors have an ORCID iD attached.'
        : 'No author has an ORCID iD attached.',
      action: 'Attach ORCID iDs for at least one author, ideally all authors.',
    }),
    coverageSignal({
      label: 'Author identity coverage',
      value: identityCoverage,
      weight: 0.35,
      severity: 'medium',
      source: 'identity',
      note:
        identityCoverage === null
          ? 'No author rows are available yet.'
          : `${identifiedAuthors}/${authorCount} author${authorCount === 1 ? '' : 's'} have ORCID or DID evidence.`,
      action: 'Attach ORCID or DID evidence to every author row.',
    }),
    boolSignal({
      label: 'Author list present',
      passed: authorCount > 0,
      weight: 0.1,
      severity: 'high',
      source: 'identity',
      note: authorCount > 0 ? `${authorCount} author row${authorCount === 1 ? '' : 's'} recorded.` : 'No author rows are recorded.',
      action: 'Record the author list before publication.',
    }),
  ]);

  const provenance = evaluateLane([
    boolSignal({
      label: 'Source archive retained',
      passed: Boolean(inputs.hasSourceArchive),
      weight: 0.3,
      severity: 'high',
      source: 'pipeline',
      note: inputs.hasSourceArchive
        ? 'A source archive is retained for independent rebuilds.'
        : 'No source archive is attached to the latest version.',
      action: 'Keep the submitted source archive with the version.',
    }),
    boolSignal({
      label: 'Compiled PDF artifact',
      passed: Boolean(inputs.hasCompiledPdf),
      weight: 0.25,
      severity: 'high',
      source: 'pipeline',
      note: inputs.hasCompiledPdf
        ? 'The compiled PDF artifact is available.'
        : 'The compiled PDF artifact is missing or still building.',
      action: 'Finish the compile/finalize pipeline.',
    }),
    boolSignal({
      label: 'HTML reader artifact',
      passed: Boolean(inputs.hasHtmlRendering),
      weight: 0.2,
      severity: 'medium',
      source: 'pipeline',
      note: inputs.hasHtmlRendering
        ? 'HTML rendering is available for accessible reading and MathJax.'
        : 'HTML rendering is missing or still converting.',
      action: 'Run the HTML conversion pipeline.',
    }),
    boolSignal({
      label: 'Version content hash',
      passed: Boolean(inputs.hasFileHash),
      weight: 0.15,
      severity: 'medium',
      source: 'pipeline',
      note: inputs.hasFileHash
        ? 'The latest binary/source version has a recorded SHA-256 hash.'
        : 'No version hash is recorded.',
      action: 'Persist the version SHA-256 hash.',
    }),
    inputs.provenanceCompletion === null || inputs.provenanceCompletion === undefined
      ? pendingSignal({
          label: 'Lifecycle provenance completion',
          weight: 0.1,
          severity: 'low',
          source: 'pipeline',
          note: 'Lifecycle timeline has not been computed yet.',
          action: 'Recompute the provenance timeline.',
        })
      : coverageSignal({
          label: 'Lifecycle provenance completion',
          value: clamp01(inputs.provenanceCompletion / 100),
          weight: 0.1,
          severity: 'low',
          source: 'pipeline',
          note: `Lifecycle timeline is ${Math.round(inputs.provenanceCompletion)}% complete.`,
          action: 'Finish missing provenance stages.',
    }),
  ]);

  const citations = buildCitationsLane(inputs);
  const math = buildMathLane(inputs);

  const detectorSignal =
    inputs.disclosureLevel && inputs.disclosureLevel !== 'none'
      ? notApplicableSignal({
          label: 'Undisclosed-AI detector',
          weight: 0.35,
          severity: 'info',
          source: 'pipeline',
          note: 'Detector is not used as a penalty because the author disclosed AI use.',
        })
      : inputs.detectorScore === null
        ? pendingSignal({
            label: 'Undisclosed-AI detector',
            weight: 0.35,
            severity: 'medium',
            source: 'pipeline',
            note: 'Detector has not produced a composite score yet.',
            action: 'Run the AI-use detector.',
          })
        : boolSignal({
            label: 'Undisclosed-AI detector',
            passed: inputs.detectorScore < threshold,
            weight: 0.35,
            severity: 'high',
            source: 'pipeline',
            note:
              inputs.detectorScore < threshold
                ? `Composite ${inputs.detectorScore} under threshold ${threshold}.`
                : `Composite ${inputs.detectorScore} over threshold ${threshold}; this is a soft flag, not proof.`,
            action: 'Review the disclosure and detector evidence before relying on this lane.',
          });

  const integrity = evaluateLane([
    detectorSignal,
    boolSignal({
      label: 'Source available for audit',
      passed: Boolean(inputs.hasSourceArchive),
      weight: 0.3,
      severity: 'high',
      source: 'pipeline',
      note: inputs.hasSourceArchive
        ? 'The source archive can be inspected against the rendered artifacts.'
        : 'No source archive is available for audit.',
      action: 'Attach or recover the source archive.',
    }),
    boolSignal({
      label: 'Version hash available',
      passed: Boolean(inputs.hasFileHash),
      weight: 0.2,
      severity: 'medium',
      source: 'pipeline',
      note: inputs.hasFileHash
        ? 'The version hash lets readers compare rebuilt artifacts.'
        : 'No version hash is recorded.',
      action: 'Persist and expose the version SHA-256 hash.',
    }),
    boolSignal({
      label: 'Human verification attested',
      passed: Boolean(inputs.disclosureHumanVerified),
      weight: 0.15,
      severity: 'high',
      source: 'author',
      note: inputs.disclosureHumanVerified
        ? 'Author explicitly accepted responsibility for verification.'
        : 'Human verification is not attested.',
      action: 'Require a human verification attestation.',
    }),
  ]);

  const disputeCount = Math.max(0, inputs.publicDisputeCount ?? 0);
  const resolvedDisputes = Math.max(
    0,
    Math.min(disputeCount, inputs.resolvedDisputeCount ?? 0),
  );
  const social = evaluateLane(
    [
      coverageSignal({
        label: 'Typed endorsement volume',
        value: inputs.endorsementCount > 0 ? Math.min(inputs.endorsementCount, 3) / 3 : 0,
        weight: 0.35,
        severity: 'low',
        source: 'community',
        note:
          inputs.endorsementCount > 0
            ? `${inputs.endorsementCount} endorsement${inputs.endorsementCount === 1 ? '' : 's'} so far.`
            : 'No structured endorsements yet.',
        action: 'Invite typed endorsements from readers who checked a specific aspect.',
      }),
      coverageSignal({
        label: 'Endorsement verb diversity',
        value:
          inputs.distinctEndorsementVerbs > 0
            ? Math.min(inputs.distinctEndorsementVerbs, 3) / 3
            : 0,
        weight: 0.35,
        severity: 'medium',
        source: 'community',
        note:
          inputs.distinctEndorsementVerbs > 0
            ? `${inputs.distinctEndorsementVerbs} distinct endorsement verb${inputs.distinctEndorsementVerbs === 1 ? '' : 's'} recorded.`
            : 'No endorsement verb diversity yet.',
        action: 'Prefer specific verbs such as checked references or reproduced result.',
      }),
      disputeCount > 0
        ? coverageSignal({
            label: 'Public lane disputes addressed',
            value: resolvedDisputes / disputeCount,
            weight: 0.3,
            severity: 'high',
            source: 'community',
            note: `${resolvedDisputes}/${disputeCount} public lane dispute${disputeCount === 1 ? '' : 's'} resolved.`,
            action: 'Respond to or resolve open Passport disputes.',
          })
        : notApplicableSignal({
            label: 'Public lane disputes addressed',
            weight: 0.3,
            severity: 'info',
            source: 'community',
            note: 'No public Passport disputes are currently filed.',
          }),
    ],
    {
      pendingWhenNoEvidence:
        inputs.endorsementCount === 0 &&
        inputs.distinctEndorsementVerbs === 0 &&
        disputeCount === 0,
    },
  );

  const laneScores = TRUST_PASSPORT_LANES.map((key) => {
    const lanes = {
      transparency,
      identity,
      provenance,
      citations,
      math,
      integrity,
      socialReview: social,
    };
    return lanes[key].score;
  });

  return {
    transparency,
    identity,
    provenance,
    citations,
    math,
    integrity,
    socialReview: social,
    transparencyScore: Math.round(laneScores.reduce((sum, score) => sum + score, 0) / laneScores.length),
  };
}

function hasCitationEvidence(inputs: TrustPassportInputs): boolean {
  return (
    inputs.hasReferenceSection !== undefined ||
    inputs.citationMarkerCount !== undefined ||
    inputs.referenceEntryCount !== undefined ||
    inputs.resolvedReferenceCount !== undefined
  );
}

function safeCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function countCoverage(value: number | null, fullCreditAt: number): number | null {
  if (value === null) return null;
  return fullCreditAt <= 0 ? 1 : Math.min(value, fullCreditAt) / fullCreditAt;
}

function buildCitationsLane(inputs: TrustPassportInputs): TrustLane {
  if (!hasCitationEvidence(inputs)) {
    return evaluateLane([
      pendingSignal({
        label: 'Citation/reference extraction',
        weight: 1,
        severity: 'medium',
        source: 'pipeline',
        note: 'Reference and citation evidence has not been extracted yet.',
        action: 'Run text extraction before judging citation support.',
      }),
    ]);
  }

  const citationMarkers = safeCount(inputs.citationMarkerCount);
  const referenceEntries = safeCount(inputs.referenceEntryCount);
  const resolvedReferences = safeCount(inputs.resolvedReferenceCount);

  return evaluateLane([
    boolSignal({
      label: 'Reference section detected',
      passed: Boolean(inputs.hasReferenceSection),
      weight: 0.3,
      severity: 'high',
      source: 'pipeline',
      note: inputs.hasReferenceSection
        ? 'A References/Bibliography section was found in the indexed text.'
        : 'No References/Bibliography section was found in the indexed text.',
      action: 'Add or repair a References/Bibliography section.',
    }),
    coverageSignal({
      label: 'In-text citation markers',
      value: countCoverage(citationMarkers, 12),
      weight: 0.25,
      severity: 'medium',
      source: 'pipeline',
      note:
        citationMarkers === null
          ? 'Citation marker extraction has not run yet.'
          : `${citationMarkers} in-text citation marker${citationMarkers === 1 ? '' : 's'} observed.`,
      action: 'Use explicit in-text citations where claims depend on references.',
    }),
    coverageSignal({
      label: 'Reference entries extracted',
      value: countCoverage(referenceEntries, 8),
      weight: 0.25,
      severity: 'high',
      source: 'pipeline',
      note:
        referenceEntries === null
          ? 'Reference entry extraction has not run yet.'
          : `${referenceEntries} reference entr${referenceEntries === 1 ? 'y' : 'ies'} extracted.`,
      action: 'Ensure each cited work appears as a parseable reference entry.',
    }),
    coverageSignal({
      label: 'Resolvable reference identifiers',
      value: countCoverage(resolvedReferences, 6),
      weight: 0.2,
      severity: 'medium',
      source: 'pipeline',
      note:
        resolvedReferences === null
          ? 'Resolvable identifier extraction has not run yet.'
          : `${resolvedReferences} DOI/arXiv/URL identifier${resolvedReferences === 1 ? '' : 's'} found.`,
      action: 'Add DOI, arXiv, or stable URLs to references where available.',
    }),
  ]);
}

function buildMathLane(inputs: TrustPassportInputs): TrustLane {
  if (inputs.mathHeavy === null || inputs.mathHeavy === undefined) {
    return evaluateLane([
      pendingSignal({
        label: 'Math/text extraction',
        weight: 1,
        severity: 'medium',
        source: 'pipeline',
        note: 'Mathematical content has not been classified from indexed text yet.',
        action: 'Run text extraction before judging mathematical auditability.',
      }),
    ]);
  }

  if (!inputs.mathHeavy) {
    return evaluateLane([
      notApplicableSignal({
        label: 'Math-heavy content detected',
        weight: 1,
        severity: 'info',
        source: 'pipeline',
        note: 'No math-heavy content was detected in the indexed text.',
      }),
    ]);
  }

  const mathExpressions = safeCount(inputs.mathExpressionCount);
  const theoremLike = safeCount(inputs.theoremLikeCount);

  return evaluateLane([
    boolSignal({
      label: 'Math-heavy content detected',
      passed: true,
      weight: 0.2,
      severity: 'info',
      source: 'pipeline',
      note: 'The indexed text contains mathematical notation or formal structure.',
    }),
    coverageSignal({
      label: 'Formula density',
      value: countCoverage(mathExpressions, 6),
      weight: 0.3,
      severity: 'medium',
      source: 'pipeline',
      note:
        mathExpressions === null
          ? 'Formula extraction has not run yet.'
          : `${mathExpressions} formula-like expression${mathExpressions === 1 ? '' : 's'} observed.`,
      action: 'Repair LaTeX/HTML extraction so formulas can be audited.',
    }),
    coverageSignal({
      label: 'Formal statement/proof structure',
      value: countCoverage(theoremLike, 4),
      weight: 0.2,
      severity: 'medium',
      source: 'pipeline',
      note:
        theoremLike === null
          ? 'Formal-structure extraction has not run yet.'
          : `${theoremLike} theorem/proof/equation cue${theoremLike === 1 ? '' : 's'} observed.`,
      action: 'Expose theorem, proof, equation, or derivation structure in the text.',
    }),
    boolSignal({
      label: 'Source available for formula audit',
      passed: Boolean(inputs.hasSourceArchive),
      weight: 0.15,
      severity: 'medium',
      source: 'pipeline',
      note: inputs.hasSourceArchive
        ? 'The source archive is available for independent formula checks.'
        : 'No source archive is available for independent formula checks.',
      action: 'Attach the source archive so equations can be rebuilt and audited.',
    }),
    boolSignal({
      label: 'Human math verification attested',
      passed: Boolean(inputs.disclosureHumanVerified),
      weight: 0.15,
      severity: 'high',
      source: 'author',
      note: inputs.disclosureHumanVerified
        ? 'Author attested that claims, citations, and numbers were human-verified.'
        : 'No author attestation covers mathematical verification.',
      action: 'Add the human verification attestation for mathematical claims.',
    }),
  ]);
}
