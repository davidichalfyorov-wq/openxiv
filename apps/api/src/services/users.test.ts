import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { Errors, ResultAsync } from '@openxiv/shared';
import type { UserRecord } from '@openxiv/db';
import { canonicalDidForProfile, makeUsersService, slugifyHandleCandidate } from './users.js';
import type { OAuthProfile } from '@openxiv/clients';
import type { AppContext } from '../context.js';

const okAsync = <T>(value: T) => ResultAsync.fromSafePromise(Promise.resolve(value));
const errAsync = <T>(error: ReturnType<typeof Errors.internal>) =>
  ResultAsync.fromPromise<T, ReturnType<typeof Errors.internal>>(
    Promise.reject(error),
    () => error,
  );

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: overrides.id ?? 'user-1',
    did: overrides.did ?? 'did:web:openxiv.net:u:orcid.0009-0009-1942-0078',
    handle: overrides.handle ?? null,
    displayName: overrides.displayName ?? 'Alice',
    avatarUrl: overrides.avatarUrl ?? null,
    orcid: overrides.orcid ?? '0009-0009-1942-0078',
    googleSub: overrides.googleSub ?? null,
    blueskyDid: overrides.blueskyDid ?? null,
    email: overrides.email ?? null,
    role: overrides.role ?? 'author',
    isAdminPromoted: overrides.isAdminPromoted ?? false,
    bio: overrides.bio ?? null,
    legacyDids: overrides.legacyDids ?? [],
    publicSigningKey: overrides.publicSigningKey ?? null,
    encryptedSigningKey: overrides.encryptedSigningKey ?? null,
    signingKeyNonce: overrides.signingKeyNonce ?? null,
    keyType: overrides.keyType ?? 'secp256k1',
    retiredPubkeys: overrides.retiredPubkeys ?? [],
    blueskySigningKey: overrides.blueskySigningKey ?? null,
    didResolutionStatus: overrides.didResolutionStatus ?? 'native',
    createdAt: overrides.createdAt ?? new Date('2026-05-20T10:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-05-20T10:00:00Z'),
  };
}

describe('canonicalDidForProfile', () => {
  it('keeps real did:plc for Bluesky users untouched', () => {
    const profile: OAuthProfile = {
      provider: 'bluesky',
      subject: 'did:plc:abcdefghijklmnopqrstuv',
      did: 'did:plc:abcdefghijklmnopqrstuv',
      displayName: 'Alice',
      handle: 'alice.bsky.social',
    };
    expect(canonicalDidForProfile(profile)).toBe('did:plc:abcdefghijklmnopqrstuv');
  });

  it('mints did:web:openxiv.net:u:orcid.{id} for ORCID users', () => {
    const profile: OAuthProfile = {
      provider: 'orcid',
      subject: '0009-0009-1942-0078',
      orcid: '0009-0009-1942-0078',
      displayName: 'Hauchen the Researcher',
    };
    expect(canonicalDidForProfile(profile)).toBe('did:web:openxiv.net:u:orcid.0009-0009-1942-0078');
  });

  it('mints did:web:openxiv.net:u:google.{sub} for Google users', () => {
    const profile: OAuthProfile = {
      provider: 'google',
      subject: '1234567890',
      displayName: 'Bob',
    };
    expect(canonicalDidForProfile(profile)).toBe('did:web:openxiv.net:u:google.1234567890');
  });

  it('never produces did:web:openxiv.local: (legacy placeholder)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('orcid'), fc.constant('google'), fc.constant('bluesky')),
        fc.string({ minLength: 3, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (provider, subject, displayName) => {
          const profile = {
            provider: provider as OAuthProfile['provider'],
            subject,
            displayName,
            ...(provider === 'bluesky' ? { did: `did:plc:${subject}` } : {}),
          };
          const did = canonicalDidForProfile(profile);
          expect(did.includes('openxiv.local')).toBe(false);
          expect(did.startsWith('did:')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sanitises subject characters that are invalid in did:web', () => {
    const profile: OAuthProfile = {
      provider: 'google',
      subject: '1234/567 890', // slash + space would break did:web path resolution
      displayName: 'Bob',
    };
    const did = canonicalDidForProfile(profile);
    expect(did).not.toContain('/');
    expect(did).not.toContain(' ');
    expect(did).toMatch(/^did:web:openxiv\.net:u:google\.[A-Za-z0-9._-]+$/);
  });
});

describe('makeUsersService.upsertFromOAuth', () => {
  it('reuses an existing ORCID row before upserting the canonical DID', async () => {
    const orcid = '0009-0009-1942-0078';
    const legacyDid = `did:web:openxiv.local:orcid.${orcid}`;
    const canonicalDid = `did:web:openxiv.net:u:orcid.${orcid}`;
    const legacyUser = userRecord({
      did: legacyDid,
      orcid,
      legacyDids: [],
      displayName: 'Alice Legacy',
    });
    const canonicalUser = {
      ...legacyUser,
      did: canonicalDid,
      displayName: 'Alice Researcher',
      legacyDids: [legacyDid],
    };
    const findByOrcid = vi.fn(() => okAsync(legacyUser));
    const findByDid = vi.fn(() => okAsync(null));
    const setCanonicalDid = vi.fn(() => okAsync(canonicalUser));
    const upsertByDid = vi.fn(() => okAsync(canonicalUser));
    const seedDefaults = vi.fn(() => okAsync(undefined));
    const insertAccountLink = vi.fn(() =>
      okAsync({
        id: 'link-1',
        userId: legacyUser.id,
        provider: 'orcid',
        subject: orcid,
        linkedVia: 'primary_signup',
        prevPrimaryDid: null,
        newPrimaryDid: canonicalDid,
        linkedAt: new Date('2026-05-20T10:00:00Z'),
        mastodonInstanceUrl: null,
        mastodonAccessToken: null,
        mastodonAccountUrl: null,
      }),
    );
    const ctx = {
      env: {
        ADMIN_DIDS: [],
        SUBMIT_ALLOW_DIDS: [],
      },
      repos: {
        users: {
          listAdmins: vi.fn(() => okAsync([])),
          findByOrcid,
          findByGoogleSub: vi.fn(),
          findByDid,
          findByHandle: vi.fn(() => okAsync(null)),
          findById: vi.fn(() => okAsync(canonicalUser)),
          setCanonicalDid,
          setRole: vi.fn(),
          upsertByDid,
        },
        profileModes: {
          seedDefaults,
        },
        accountLinks: {
          findByProviderSubject: vi.fn(() => okAsync(null)),
          insert: insertAccountLink,
        },
      },
    } as unknown as AppContext;

    const result = await makeUsersService(ctx).upsertFromOAuth({
      provider: 'orcid',
      subject: orcid,
      orcid,
      displayName: 'Alice Researcher',
    });

    expect(result.isOk()).toBe(true);
    expect(findByOrcid).toHaveBeenCalledWith(orcid);
    expect(setCanonicalDid).toHaveBeenCalledWith({
      id: legacyUser.id,
      did: canonicalDid,
      resolutionStatus: 'native',
      appendLegacy: legacyDid,
    });
    expect(upsertByDid).toHaveBeenCalledWith(
      expect.objectContaining({
        did: canonicalDid,
        orcid,
        displayName: 'Alice Researcher',
      }),
    );
    expect(seedDefaults).toHaveBeenCalledWith(legacyUser.id);
    expect(insertAccountLink).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: legacyUser.id,
        provider: 'orcid',
        subject: orcid,
        newPrimaryDid: canonicalDid,
      }),
    );
  });

  it('preserves a higher-priority primary DID when ORCID is already linked', async () => {
    const orcid = '0009-0003-6027-7837';
    const primaryDid = 'did:plc:dzhzljg4peg765tpd2q63luc';
    const orcidDid = `did:web:openxiv.net:u:orcid.${orcid}`;
    const existingUser = userRecord({
      id: 'admin-user',
      did: primaryDid,
      orcid,
      handle: 'ddavidich.bsky.social',
      role: 'admin',
      isAdminPromoted: true,
      legacyDids: [`did:web:openxiv.local:orcid.${orcid}`, orcidDid],
      displayName: 'D. Davidich',
    });
    const findByOrcid = vi.fn(() => okAsync(existingUser));
    const setCanonicalDid = vi.fn();
    const upsertByDid = vi.fn(() => okAsync(existingUser));
    const ctx = {
      env: {
        ADMIN_DIDS: [],
        SUBMIT_ALLOW_DIDS: [],
      },
      repos: {
        users: {
          listAdmins: vi.fn(() => okAsync([existingUser])),
          findByOrcid,
          findByGoogleSub: vi.fn(),
          findByDid: vi.fn(),
          findByHandle: vi.fn(() => okAsync(null)),
          findById: vi.fn(() => okAsync(existingUser)),
          setCanonicalDid,
          setRole: vi.fn(),
          upsertByDid,
        },
        profileModes: {
          seedDefaults: vi.fn(() => okAsync(undefined)),
        },
        accountLinks: {
          findByProviderSubject: vi.fn(() =>
            okAsync({
              id: 'link-1',
              userId: existingUser.id,
              provider: 'orcid',
              subject: orcid,
              linkedVia: 'primary_signup',
              prevPrimaryDid: null,
              newPrimaryDid: primaryDid,
              linkedAt: new Date('2026-05-20T10:00:00Z'),
              mastodonInstanceUrl: null,
              mastodonAccessToken: null,
              mastodonAccountUrl: null,
            }),
          ),
          insert: vi.fn(),
        },
      },
    } as unknown as AppContext;

    const result = await makeUsersService(ctx).upsertFromOAuth({
      provider: 'orcid',
      subject: orcid,
      orcid,
      displayName: 'D. Davidich',
    });

    expect(result.isOk()).toBe(true);
    expect(findByOrcid).toHaveBeenCalledWith(orcid);
    expect(setCanonicalDid).not.toHaveBeenCalled();
    expect(upsertByDid).toHaveBeenCalledWith(
      expect.objectContaining({
        did: primaryDid,
        orcid,
        displayName: 'D. Davidich',
      }),
    );
  });

  it('recovers an ORCID sign-in when the DID upsert races the ORCID unique index', async () => {
    const orcid = '0009-0003-6027-7837';
    const primaryDid = 'did:plc:dzhzljg4peg765tpd2q63luc';
    const orcidDid = `did:web:openxiv.net:u:orcid.${orcid}`;
    const existingUser = userRecord({
      id: 'existing-user',
      did: primaryDid,
      orcid,
      legacyDids: [orcidDid],
      displayName: 'D. Davidich',
    });
    const uniqueOrcidError = Errors.internal(
      'users.upsertByDid',
      new Error('duplicate key value violates unique constraint "users_orcid_idx"'),
    );
    const findByOrcid = vi
      .fn()
      .mockReturnValueOnce(okAsync(null))
      .mockReturnValueOnce(okAsync(existingUser));
    const upsertByDid = vi.fn(() => errAsync<UserRecord>(uniqueOrcidError));
    const seedDefaults = vi.fn(() => okAsync(undefined));
    const ctx = {
      env: {
        ADMIN_DIDS: [],
        SUBMIT_ALLOW_DIDS: [],
      },
      repos: {
        users: {
          listAdmins: vi.fn(() => okAsync([])),
          findByOrcid,
          findByGoogleSub: vi.fn(),
          findByDid: vi.fn(),
          findByHandle: vi.fn(() => okAsync(null)),
          findById: vi.fn(() => okAsync(existingUser)),
          setCanonicalDid: vi.fn(),
          setRole: vi.fn(),
          upsertByDid,
        },
        profileModes: {
          seedDefaults,
        },
        accountLinks: {
          findByProviderSubject: vi.fn(() =>
            okAsync({
              id: 'link-1',
              userId: existingUser.id,
              provider: 'orcid',
              subject: orcid,
              linkedVia: 'primary_signup',
              prevPrimaryDid: null,
              newPrimaryDid: primaryDid,
              linkedAt: new Date('2026-05-20T10:00:00Z'),
              mastodonInstanceUrl: null,
              mastodonAccessToken: null,
              mastodonAccountUrl: null,
            }),
          ),
          insert: vi.fn(),
        },
      },
    } as unknown as AppContext;

    const result = await makeUsersService(ctx).upsertFromOAuth({
      provider: 'orcid',
      subject: orcid,
      orcid,
      displayName: 'D. Davidich',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(existingUser);
    expect(findByOrcid).toHaveBeenCalledTimes(2);
    expect(upsertByDid).toHaveBeenCalledWith(
      expect.objectContaining({
        did: orcidDid,
        orcid,
      }),
    );
    expect(seedDefaults).toHaveBeenCalledWith(existingUser.id);
  });
});

describe('slugifyHandleCandidate', () => {
  it('uses a lowercase ASCII slug derived from displayName when possible', () => {
    expect(
      slugifyHandleCandidate({
        provider: 'orcid',
        subject: '0009-0009-1942-0078',
        displayName: 'Dr. Hau Chen',
      }),
    ).toBe('dr-hau-chen');
  });

  it('strips leading and trailing hyphens', () => {
    expect(
      slugifyHandleCandidate({
        provider: 'google',
        subject: '1',
        displayName: '--Bob--',
      }),
    ).toBe('bob');
  });

  it('falls back to orcid-{stripped} when displayName slug is too short', () => {
    expect(
      slugifyHandleCandidate({
        provider: 'orcid',
        subject: '0009-0009-1942-0078',
        displayName: 'A', // only 1 char post-slugify
      }),
    ).toBe('orcid-00090009194200');
  });

  it('falls back to g-{prefix} for Google when displayName slug fails', () => {
    expect(
      slugifyHandleCandidate({
        provider: 'google',
        subject: '1234567890ABCDEF',
        displayName: '!!!', // empty after slugify
      }),
    ).toBe('g-123456');
  });

  it('caps slug at 30 characters', () => {
    const long = 'A'.repeat(200);
    const slug = slugifyHandleCandidate({
      provider: 'orcid',
      subject: '0009',
      displayName: long,
    });
    expect(slug.length).toBeLessThanOrEqual(30);
  });

  it('never produces a slug that starts or ends with a hyphen, for any reasonable name', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (name) => {
        const slug = slugifyHandleCandidate({
          provider: 'orcid',
          subject: '1234567890',
          displayName: name,
        });
        expect(slug.startsWith('-')).toBe(false);
        expect(slug.endsWith('-')).toBe(false);
        expect(slug.length).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 200 },
    );
  });
});
