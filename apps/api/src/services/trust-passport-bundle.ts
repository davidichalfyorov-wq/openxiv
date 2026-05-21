import type { TrustLane, TrustLaneState, TrustPassport } from '@openxiv/shared';
import { getPublicKey, hashes, sign, utils as secpUtils, verify } from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { multibaseToPubkey, pubkeyToMultibase } from './user-keys.js';

hashes.sha256 = sha256;
hashes.hmacSha256 = (key, msg) => hmac(sha256, key, msg);

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PassportLaneStatus = 'green' | 'yellow' | 'red' | 'pending';

export interface TrustPassportCheckItem {
  readonly label: string;
  readonly passed: boolean;
  readonly status: 'pass' | 'fail' | 'pending' | 'not_applicable';
  readonly note: string;
  readonly weight: number;
  readonly value: number | null;
  readonly severity: 'info' | 'low' | 'medium' | 'high';
  readonly source: 'author' | 'pipeline' | 'identity' | 'community';
  readonly action?: string;
  readonly ref?: string;
  readonly resolved?: string | null;
  readonly via?: 'doi' | 'arxiv' | 'url' | 'unresolved';
  readonly confidence?: 'high' | 'medium' | 'low';
  readonly reason?: string;
  readonly category?: string;
  readonly section?: string;
  readonly anchor?: string | null;
  readonly snippet?: string;
}

export interface TrustPassportLaneCheck {
  readonly lane:
    | 'transparency'
    | 'identity'
    | 'provenance'
    | 'citations'
    | 'math'
    | 'integrity'
    | 'socialReview';
  readonly checker: string;
  readonly status: PassportLaneStatus;
  readonly issueLevel: 'none' | 'watch' | 'needs-work' | 'blocked';
  readonly nextActions: ReadonlyArray<string>;
  readonly summary: TrustPassportLaneSummary;
  readonly items: ReadonlyArray<TrustPassportCheckItem>;
}

export interface TrustPassportLaneSummary {
  readonly passedItems: number;
  readonly attentionItems: number;
  readonly pendingItems: number;
  readonly notApplicableItems: number;
  readonly disputeCount: number;
  readonly unresolvedDisputeCount: number;
  readonly highlightedDisputeCount: number;
  readonly responseCount: number;
  readonly externalAttestationCount: number;
  readonly verifiedExternalAttestationCount: number;
  readonly unverifiedExternalAttestationCount: number;
  readonly historyState:
    | 'computed'
    | 'externally_attested'
    | 'contested'
    | 'answered_contestation'
    | 'contested_and_attested';
  readonly lastActivityAt: string | null;
  readonly topAction?: string;
}

export interface TrustPassportJsonLd {
  readonly '@context': readonly unknown[];
  readonly type: 'OpenXivTrustPassport';
  readonly id: string;
  readonly paper_id: string;
  readonly paper_uuid: string;
  readonly paper_url: string;
  readonly title: string;
  readonly version_id: string | null;
  readonly generatedAt: string;
  readonly issuer: string;
  readonly semanticDigest: string;
  readonly checks: ReadonlyArray<TrustPassportLaneCheck>;
  readonly publicDisputes: ReadonlyArray<TrustPassportPublicDispute>;
  readonly publicDisputeResponses: ReadonlyArray<TrustPassportPublicDisputeResponse>;
  readonly externalAttestations: ReadonlyArray<TrustPassportExternalAttestation>;
  readonly history: ReadonlyArray<TrustPassportHistoryEvent>;
}

export interface TrustPassportPublicDispute {
  readonly id: string;
  readonly uri: string;
  readonly lane: TrustPassportLaneCheck['lane'];
  readonly authorDid: string;
  readonly text: string;
  readonly targetRef: string | null;
  readonly status: 'open' | 'highlighted' | 'resolved';
  readonly createdAt: string;
}

export interface TrustPassportPublicDisputeResponse {
  readonly id: string;
  readonly uri: string;
  readonly disputeId: string;
  readonly disputeUri: string | null;
  readonly lane: TrustPassportLaneCheck['lane'];
  readonly authorDid: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface TrustPassportExternalAttestation {
  readonly id: string;
  readonly uri: string;
  readonly issuer: string;
  readonly publicKeyMultibase: string;
  readonly lane: TrustPassportLaneCheck['lane'];
  readonly statement: string;
  readonly signature: string;
  readonly signatureVerified: boolean;
  readonly verificationUrl: string | null;
  readonly createdAt: string;
}

export interface TrustPassportHistoryEvent {
  readonly id: string;
  readonly type: 'public_dispute' | 'dispute_response' | 'external_attestation';
  readonly lane: TrustPassportLaneCheck['lane'];
  readonly actorDid: string;
  readonly uri: string;
  readonly createdAt: string;
  readonly text?: string;
  readonly statement?: string;
  readonly targetRef?: string | null;
  readonly status?: 'open' | 'highlighted' | 'resolved';
  readonly relatedId?: string;
  readonly relatedUri?: string | null;
  readonly issuer?: string;
  readonly publicKeyMultibase?: string;
  readonly signature?: string;
  readonly signatureVerified?: boolean;
  readonly verificationUrl?: string | null;
}

export interface ExternalAttestationSignatureInput {
  readonly issuer: string;
  readonly publicKeyMultibase: string;
  readonly paper_id: string;
  readonly lane: TrustPassportLaneCheck['lane'];
  readonly statement: string;
  readonly verificationUrl: string | null;
  readonly createdAt: string;
}

export interface ExternalAttestationSubmission extends ExternalAttestationSignatureInput {
  readonly signature: string;
}

export interface TrustPassportProof {
  readonly type: 'EcdsaSecp256k1Signature2019';
  readonly created: string;
  readonly proofPurpose: 'assertionMethod';
  readonly verificationMethod: string;
  readonly canonicalizationAlgorithm: 'openxiv-json-canonical-v1';
  readonly digestAlgorithm: 'SHA-256';
}

export type SignedTrustPassportJsonLd = TrustPassportJsonLd & {
  readonly proof: TrustPassportProof;
  readonly signature: string;
};

export interface BuildTrustPassportJsonLdInput {
  readonly publicBase: string;
  readonly paperId: string;
  readonly openxivId: string | null;
  readonly openxivUrlId: string | null;
  readonly title: string;
  readonly versionId: string | null;
  readonly generatedAt: string;
  readonly issuerDid: string;
  readonly trust: TrustPassport;
  readonly citationItems?: ReadonlyArray<TrustPassportCheckItem>;
  readonly mathItems?: ReadonlyArray<TrustPassportCheckItem>;
  readonly publicDisputes?: ReadonlyArray<TrustPassportPublicDispute>;
  readonly publicDisputeResponses?: ReadonlyArray<TrustPassportPublicDisputeResponse>;
  readonly externalAttestations?: ReadonlyArray<TrustPassportExternalAttestation>;
}

const LANE_ORDER = [
  'transparency',
  'identity',
  'provenance',
  'citations',
  'math',
  'integrity',
  'socialReview',
] as const;
const CHECKER_BY_LANE: Record<(typeof LANE_ORDER)[number], string> = {
  transparency: 'openxiv-transparency-v1.0',
  identity: 'openxiv-identity-v1.0',
  provenance: 'openxiv-provenance-v1.0',
  citations: 'openxiv-citations-v1.0',
  math: 'openxiv-math-v1.0',
  integrity: 'openxiv-integrity-v1.0',
  socialReview: 'openxiv-social-review-v1.0',
};

export function buildTrustPassportJsonLd(
  input: BuildTrustPassportJsonLdInput,
): TrustPassportJsonLd {
  const publicBase = input.publicBase.replace(/\/+$/, '');
  const urlId = input.openxivUrlId ?? input.paperId;
  const bundleWithoutDigest = {
    '@context': [
      'https://schema.org',
      {
        ox: 'https://openxiv.net/ns/trust#',
        OpenXivTrustPassport: 'ox:OpenXivTrustPassport',
        checks: 'ox:checks',
        publicDisputes: 'ox:publicDisputes',
        publicDisputeResponses: 'ox:publicDisputeResponses',
        externalAttestations: 'ox:externalAttestations',
        history: 'ox:history',
        historyState: 'ox:historyState',
        verifiedExternalAttestationCount: 'ox:verifiedExternalAttestationCount',
        highlightedDisputeCount: 'ox:highlightedDisputeCount',
      },
    ],
    type: 'OpenXivTrustPassport',
    id: `${publicBase}/abs/${urlId}/passport.json`,
    paper_id: input.openxivId ?? `openxiv:${input.paperId}`,
    paper_uuid: input.paperId,
    paper_url: `${publicBase}/abs/${urlId}`,
    title: input.title,
    version_id: input.versionId,
    generatedAt: input.generatedAt,
    issuer: input.issuerDid,
    checks: LANE_ORDER.map((lane) =>
      laneToCheck(lane, input.trust[lane], input, overrideItems(lane, input)),
    ),
    publicDisputes: input.publicDisputes ?? [],
    publicDisputeResponses: input.publicDisputeResponses ?? [],
    externalAttestations: input.externalAttestations ?? [],
    history: buildTrustPassportHistory(input),
  } satisfies Omit<TrustPassportJsonLd, 'semanticDigest'>;
  return {
    ...bundleWithoutDigest,
    semanticDigest: passportSemanticDigest(bundleWithoutDigest),
  };
}

export function signTrustPassportBundle(
  unsigned: TrustPassportJsonLd,
  privateKey: Uint8Array,
  options: { created?: string; verificationMethod?: string } = {},
): SignedTrustPassportJsonLd {
  if (!secpUtils.isValidSecretKey(privateKey)) {
    throw new Error('service signing key is not a valid secp256k1 private key');
  }
  const proof: TrustPassportProof = {
    type: 'EcdsaSecp256k1Signature2019',
    created: options.created ?? new Date().toISOString(),
    proofPurpose: 'assertionMethod',
    verificationMethod: options.verificationMethod ?? `${unsigned.issuer}#atproto`,
    canonicalizationAlgorithm: 'openxiv-json-canonical-v1',
    digestAlgorithm: 'SHA-256',
  };
  const signingPayload = { ...unsigned, proof };
  const signature = sign(utf8(canonicalJson(signingPayload)), privateKey, { format: 'compact' });
  return { ...signingPayload, signature: bytesToBase64Url(signature) };
}

export function verifyTrustPassportBundle(
  signed: SignedTrustPassportJsonLd,
  publicKey: Uint8Array,
): boolean {
  if (!signed.signature || !signed.proof) return false;
  const { signature, ...withoutSignature } = signed;
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlToBytes(signature);
  } catch {
    return false;
  }
  try {
    return verify(sigBytes, utf8(canonicalJson(withoutSignature)), publicKey);
  } catch {
    return false;
  }
}

export function externalAttestationSigningPayload(
  input: ExternalAttestationSignatureInput,
): ExternalAttestationSignatureInput {
  return {
    issuer: input.issuer,
    publicKeyMultibase: input.publicKeyMultibase,
    paper_id: input.paper_id,
    lane: input.lane,
    statement: input.statement,
    verificationUrl: input.verificationUrl ?? null,
    createdAt: input.createdAt,
  };
}

export function verifyExternalAttestationSignature(input: ExternalAttestationSubmission): boolean {
  let publicKey: Uint8Array;
  let signature: Uint8Array;
  try {
    publicKey = multibaseToPubkey(input.publicKeyMultibase);
    signature = base64UrlToBytes(input.signature);
  } catch {
    return false;
  }
  try {
    return verify(
      signature,
      utf8(canonicalJson(externalAttestationSigningPayload(input))),
      publicKey,
    );
  } catch {
    return false;
  }
}

export function passportSemanticDigest(
  passport: Omit<TrustPassportJsonLd, 'semanticDigest'>,
): string {
  const semanticPayload = {
    id: passport.id,
    paper_id: passport.paper_id,
    paper_uuid: passport.paper_uuid,
    paper_url: passport.paper_url,
    title: passport.title,
    version_id: passport.version_id,
    issuer: passport.issuer,
    checks: passport.checks,
    publicDisputes: passport.publicDisputes,
    publicDisputeResponses: passport.publicDisputeResponses,
    externalAttestations: passport.externalAttestations,
    history: passport.history,
  };
  const digest = sha256(utf8(canonicalJson(semanticPayload)));
  return `sha256-${Buffer.from(digest).toString('base64url')}`;
}

export function signWithConfiguredServiceKey(
  unsigned: TrustPassportJsonLd,
  env: { JWT_SECRET?: string; FEED_GENERATOR_DID?: string },
  now = new Date(),
): SignedTrustPassportJsonLd {
  const key = loadServiceSigningKey(env);
  return signTrustPassportBundle(unsigned, key.privateKey, {
    created: now.toISOString(),
    verificationMethod: `${unsigned.issuer}#atproto`,
  });
}

export function loadServiceSigningKey(
  env: {
    JWT_SECRET?: string;
  } = process.env,
): { privateKey: Uint8Array; publicKey: Uint8Array; publicMultibase: string; source: string } {
  const fromBase64 = process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
  if (fromBase64) {
    const privateKey = new Uint8Array(Buffer.from(fromBase64, 'base64'));
    return finalizePrivateKey(privateKey, 'OPENXIV_SERVICE_PRIVATE_KEY_BASE64');
  }

  const fromHex = process.env['OPENXIV_SERVICE_PRIVATE_KEY_HEX'];
  if (fromHex) {
    const privateKey = hexToBytes(fromHex);
    return finalizePrivateKey(privateKey, 'OPENXIV_SERVICE_PRIVATE_KEY_HEX');
  }

  const seed = env.JWT_SECRET ?? process.env['JWT_SECRET'] ?? '';
  if (seed.length < 32) {
    throw new Error(
      'Trust Passport signing requires OPENXIV_SERVICE_PRIVATE_KEY_BASE64, OPENXIV_SERVICE_PRIVATE_KEY_HEX, or JWT_SECRET >= 32 chars for local fallback.',
    );
  }
  const derived = sha256(utf8(`openxiv-trust-passport-service-key-v1:${seed}`));
  return finalizePrivateKey(derived, 'derived-from-JWT_SECRET');
}

export function servicePublicMultibase(env: { JWT_SECRET?: string } = process.env): string {
  return (
    process.env['OPENXIV_SERVICE_PUBLIC_MULTIBASE'] ?? loadServiceSigningKey(env).publicMultibase
  );
}

export function configuredServicePublicMultibase(
  env: { JWT_SECRET?: string } = process.env,
): string | null {
  if (process.env['OPENXIV_SERVICE_PUBLIC_MULTIBASE']) {
    return process.env['OPENXIV_SERVICE_PUBLIC_MULTIBASE'];
  }
  try {
    return loadServiceSigningKey(env).publicMultibase;
  } catch {
    return null;
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function laneToCheck(
  lane: (typeof LANE_ORDER)[number],
  trustLane: TrustLane,
  input: BuildTrustPassportJsonLdInput,
  overrideItems?: ReadonlyArray<TrustPassportCheckItem>,
): TrustPassportLaneCheck {
  const items =
    overrideItems && overrideItems.length > 0
      ? overrideItems
      : trustLane.checks.map((check) => ({
          label: check.label,
          passed: check.passed,
          status: check.status,
          note: check.note,
          weight: check.weight,
          value: check.value,
          severity: check.severity,
          source: check.source,
          ...(check.action ? { action: check.action } : {}),
        }));
  const summary = summarizeLane(lane, items, trustLane, input);
  const longitudinal = applyLongitudinalSignals(lane, trustLane, summary);
  return {
    lane,
    checker: CHECKER_BY_LANE[lane],
    status: longitudinal.status,
    issueLevel: longitudinal.issueLevel,
    nextActions: longitudinal.nextActions,
    summary,
    items,
  };
}

function applyLongitudinalSignals(
  lane: (typeof LANE_ORDER)[number],
  trustLane: TrustLane,
  summary: TrustPassportLaneSummary,
): {
  status: PassportLaneStatus;
  issueLevel: TrustPassportLaneCheck['issueLevel'];
  nextActions: ReadonlyArray<string>;
} {
  let status = statusFor(trustLane.state);
  let issueLevel = trustLane.issueLevel;
  const nextActions = [...trustLane.nextActions];

  if (summary.highlightedDisputeCount > 0) {
    status = 'red';
    issueLevel = maxIssueLevel(issueLevel, 'blocked');
    nextActions.unshift(
      `Resolve ${summary.highlightedDisputeCount} highlighted ${lane} dispute${summary.highlightedDisputeCount === 1 ? '' : 's'}.`,
    );
  } else if (summary.unresolvedDisputeCount > 0) {
    if (status === 'green' || status === 'pending') status = 'yellow';
    issueLevel = maxIssueLevel(issueLevel, 'needs-work');
    nextActions.unshift(
      `Respond to or resolve ${summary.unresolvedDisputeCount} open ${lane} dispute${summary.unresolvedDisputeCount === 1 ? '' : 's'}.`,
    );
  } else if (summary.verifiedExternalAttestationCount > 0 && status === 'pending') {
    status = 'yellow';
    issueLevel = maxIssueLevel(issueLevel, 'watch');
  }

  return { status, issueLevel, nextActions: Array.from(new Set(nextActions)).slice(0, 5) };
}

function summarizeLane(
  lane: (typeof LANE_ORDER)[number],
  items: ReadonlyArray<TrustPassportCheckItem>,
  trustLane: TrustLane,
  input: BuildTrustPassportJsonLdInput,
): TrustPassportLaneSummary {
  const disputes = (input.publicDisputes ?? []).filter((dispute) => dispute.lane === lane);
  const responses = (input.publicDisputeResponses ?? []).filter(
    (response) => response.lane === lane,
  );
  const attestations = (input.externalAttestations ?? []).filter(
    (attestation) => attestation.lane === lane,
  );
  const unresolvedDisputes = disputes.filter((dispute) => dispute.status !== 'resolved');
  const highlightedDisputes = disputes.filter((dispute) => dispute.status === 'highlighted');
  const verifiedAttestations = attestations.filter((attestation) => attestation.signatureVerified);
  const unverifiedAttestations = attestations.filter(
    (attestation) => !attestation.signatureVerified,
  );
  const lastActivityAt = latestIso([
    ...disputes.map((event) => event.createdAt),
    ...responses.map((event) => event.createdAt),
    ...attestations.map((event) => event.createdAt),
  ]);
  const historyState = laneHistoryState({
    unresolvedDisputeCount: unresolvedDisputes.length,
    responseCount: responses.length,
    verifiedExternalAttestationCount: verifiedAttestations.length,
  });
  const actionable = items.find(
    (item) =>
      (item.status === 'fail' || item.status === 'pending') &&
      typeof item.action === 'string' &&
      item.action.length > 0,
  );
  const disputeAction =
    highlightedDisputes.length > 0
      ? `Resolve ${highlightedDisputes.length} highlighted ${lane} dispute${highlightedDisputes.length === 1 ? '' : 's'}.`
      : unresolvedDisputes.length > 0
        ? `Respond to or resolve ${unresolvedDisputes.length} open ${lane} dispute${unresolvedDisputes.length === 1 ? '' : 's'}.`
        : undefined;
  const topAction = disputeAction ?? actionable?.action ?? trustLane.nextActions[0];
  return {
    passedItems: items.filter((item) => item.status === 'pass').length,
    attentionItems: items.filter((item) => item.status === 'fail').length,
    pendingItems: items.filter((item) => item.status === 'pending').length,
    notApplicableItems: items.filter((item) => item.status === 'not_applicable').length,
    disputeCount: disputes.length,
    unresolvedDisputeCount: unresolvedDisputes.length,
    highlightedDisputeCount: highlightedDisputes.length,
    responseCount: responses.length,
    externalAttestationCount: attestations.length,
    verifiedExternalAttestationCount: verifiedAttestations.length,
    unverifiedExternalAttestationCount: unverifiedAttestations.length,
    historyState,
    lastActivityAt,
    ...(topAction ? { topAction } : {}),
  };
}

function laneHistoryState(input: {
  readonly unresolvedDisputeCount: number;
  readonly responseCount: number;
  readonly verifiedExternalAttestationCount: number;
}): TrustPassportLaneSummary['historyState'] {
  if (input.unresolvedDisputeCount > 0 && input.verifiedExternalAttestationCount > 0) {
    return 'contested_and_attested';
  }
  if (input.unresolvedDisputeCount > 0 && input.responseCount > 0) {
    return 'answered_contestation';
  }
  if (input.unresolvedDisputeCount > 0) return 'contested';
  if (input.verifiedExternalAttestationCount > 0) return 'externally_attested';
  return 'computed';
}

function latestIso(values: ReadonlyArray<string>): string | null {
  let latestValue: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const time = Date.parse(value);
    if (Number.isFinite(time) && time > latestTime) {
      latestTime = time;
      latestValue = value;
    }
  }
  return latestValue;
}

function maxIssueLevel(
  a: TrustPassportLaneCheck['issueLevel'],
  b: TrustPassportLaneCheck['issueLevel'],
): TrustPassportLaneCheck['issueLevel'] {
  const rank: Record<TrustPassportLaneCheck['issueLevel'], number> = {
    none: 0,
    watch: 1,
    'needs-work': 2,
    blocked: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

function overrideItems(
  lane: (typeof LANE_ORDER)[number],
  input: BuildTrustPassportJsonLdInput,
): ReadonlyArray<TrustPassportCheckItem> | undefined {
  if (lane === 'citations') return input.citationItems;
  if (lane === 'math') return input.mathItems;
  return undefined;
}

function buildTrustPassportHistory(
  input: BuildTrustPassportJsonLdInput,
): TrustPassportHistoryEvent[] {
  const disputes = (input.publicDisputes ?? []).map(
    (dispute): TrustPassportHistoryEvent => ({
      id: dispute.id,
      type: 'public_dispute',
      lane: dispute.lane,
      actorDid: dispute.authorDid,
      uri: dispute.uri,
      createdAt: dispute.createdAt,
      text: dispute.text,
      targetRef: dispute.targetRef,
      status: dispute.status,
    }),
  );
  const responses = (input.publicDisputeResponses ?? []).map(
    (response): TrustPassportHistoryEvent => ({
      id: response.id,
      type: 'dispute_response',
      lane: response.lane,
      actorDid: response.authorDid,
      uri: response.uri,
      createdAt: response.createdAt,
      text: response.text,
      relatedId: response.disputeId,
      relatedUri: response.disputeUri,
    }),
  );
  const attestations = (input.externalAttestations ?? []).map(
    (attestation): TrustPassportHistoryEvent => ({
      id: attestation.id,
      type: 'external_attestation',
      lane: attestation.lane,
      actorDid: attestation.issuer,
      uri: attestation.uri,
      createdAt: attestation.createdAt,
      statement: attestation.statement,
      issuer: attestation.issuer,
      publicKeyMultibase: attestation.publicKeyMultibase,
      signature: attestation.signature,
      signatureVerified: attestation.signatureVerified,
      verificationUrl: attestation.verificationUrl,
    }),
  );
  return [...disputes, ...responses, ...attestations].sort((a, b) => {
    const time = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (Number.isFinite(time) && time !== 0) return time;
    return `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`);
  });
}

function statusFor(state: TrustLaneState): PassportLaneStatus {
  switch (state) {
    case 'strong':
      return 'green';
    case 'partial':
      return 'yellow';
    case 'absent':
      return 'red';
    case 'pending':
      return 'pending';
  }
}

function finalizePrivateKey(privateKey: Uint8Array, source: string) {
  if (privateKey.length !== 32 || !secpUtils.isValidSecretKey(privateKey)) {
    throw new Error(`${source} must decode to a valid 32-byte secp256k1 private key`);
  }
  const publicKey = getPublicKey(privateKey, true);
  return { privateKey, publicKey, publicMultibase: pubkeyToMultibase(publicKey), source };
}

function canonicalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('cannot canonicalize non-finite number');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      out[key] = canonicalize(child);
    }
    return out;
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('OPENXIV_SERVICE_PRIVATE_KEY_HEX must be even-length hex');
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}
