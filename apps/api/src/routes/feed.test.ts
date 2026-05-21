import { describe, expect, it } from 'vitest';
import type { UserRecord } from '@openxiv/db';
import { resolveBlueskyDidForFeed, serializeItem } from './feed.js';

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    did: 'did:web:openxiv.net:u:orcid.0009',
    handle: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    orcid: null,
    googleSub: null,
    blueskyDid: null,
    email: null,
    role: 'author',
    isAdminPromoted: false,
    bio: null,
    legacyDids: [],
    publicSigningKey: null,
    encryptedSigningKey: null,
    signingKeyNonce: null,
    keyType: 'secp256k1',
    retiredPubkeys: [],
    blueskySigningKey: null,
    didResolutionStatus: 'native',
    createdAt: new Date('2026-05-18T12:00:00Z'),
    updatedAt: new Date('2026-05-18T12:00:00Z'),
    ...overrides,
  };
}

describe('resolveBlueskyDidForFeed', () => {
  it('uses the current user row blueskyDid instead of any global owner DID', () => {
    expect(
      resolveBlueskyDidForFeed(
        user({
          id: 'user-2',
          did: 'did:web:openxiv.net:u:orcid.0002',
          blueskyDid: 'did:plc:bob',
        }),
      ),
    ).toBe('did:plc:bob');
  });

  it('falls back to the current primary did:plc user DID', () => {
    expect(resolveBlueskyDidForFeed(user({ did: 'did:plc:carol' }))).toBe(
      'did:plc:carol',
    );
  });

  it('returns null for users without a Bluesky link', () => {
    expect(resolveBlueskyDidForFeed(user())).toBeNull();
  });
});

describe('serializeItem', () => {
  it('serializes paper feed items with complete PaperSummary fields and a human byline', () => {
    const result = serializeItem({
      kind: 'paper',
      createdAt: new Date('2026-05-19T12:00:00Z'),
      weight: 0.75,
      trustPassport: {
        transparency: { state: 'strong', issueLevel: 'none', nextActions: [] },
        identity: { state: 'strong', issueLevel: 'none', nextActions: [] },
        provenance: { state: 'partial', issueLevel: 'watch', nextActions: ['Finish provenance.'] },
        citations: { state: 'pending', issueLevel: 'watch', nextActions: ['Run citation extraction.'] },
        math: { state: 'strong', issueLevel: 'none', nextActions: [] },
        integrity: { state: 'partial', issueLevel: 'needs-work', nextActions: ['Review integrity.'] },
        socialReview: { state: 'pending', issueLevel: 'watch', nextActions: [] },
      },
      authors: [
        {
          paperId: 'paper-1',
          position: 0,
          did: null,
          displayName: 'David Alfyorov',
          orcid: '0009-0003-6027-7837',
          affiliation: null,
          affiliationRor: null,
          creditRoles: [],
          isCorresponding: true,
        },
      ],
      paper: {
        id: 'paper-1',
        openxivId: 'openxiv:math-ph.2026.00012',
        uri: 'at://did:plc:author/app.openxiv.paper/abc',
        cid: null,
        submitterDid: 'did:web:openxiv.local:orcid.0009-0003-6027-7837',
        title: 'A de Sitter region at every black-hole core',
        abstract: null,
        license: 'CC-BY-4.0',
        primaryCategory: 'math-ph',
        crossListings: ['gr-qc'],
        doi: null,
        status: 'published',
        versionNote: null,
        supersedesUri: null,
        submissionTermsVersion: null,
        submissionTermsAcceptedAt: null,
        oneHardQuestion: null,
        launchKit: null,
        createdAt: new Date('2026-05-19T11:00:00Z'),
        updatedAt: new Date('2026-05-19T11:30:00Z'),
        publishedAt: new Date('2026-05-19T12:00:00Z'),
      },
    });

    expect(result).toMatchObject({
      kind: 'paper',
      trustPassport: {
        transparency: { state: 'strong', issueLevel: 'none' },
        provenance: { state: 'partial', issueLevel: 'watch' },
      },
      paper: {
        openxivUrlId: 'math-ph.2026.00012',
        createdAt: '2026-05-19T11:00:00.000Z',
        crossListings: ['gr-qc'],
        authorNames: ['David Alfyorov'],
        authorLine: 'David Alfyorov',
      },
    });
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('trustScore');
  });
});
