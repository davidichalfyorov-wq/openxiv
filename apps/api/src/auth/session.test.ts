import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { signSession, verifySession } from './session.js';

const SECRET = 'a'.repeat(32);

const userFixture = {
  id: '11111111-2222-3333-4444-555555555555',
  did: 'did:plc:abcdefghijklmnopqrstuvwx',
  role: 'author' as const,
  displayName: 'A',
  handle: null,
  avatarUrl: null,
  orcid: null,
  googleSub: null,
  blueskyDid: null,
  email: null,
  bio: null,
  isAdminPromoted: false,
  legacyDids: [],
  publicSigningKey: null,
  encryptedSigningKey: null,
  signingKeyNonce: null,
  keyType: 'secp256k1',
  retiredPubkeys: [],
  blueskySigningKey: null,
  didResolutionStatus: 'native',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('session signing', () => {
  it('round-trips a session token', async () => {
    const token = await signSession(SECRET, userFixture, 60);
    const payload = await verifySession(SECRET, token);
    expect(payload.uid).toBe(userFixture.id);
    expect(payload.did).toBe(userFixture.did);
    expect(payload.role).toBe('author');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(SECRET, userFixture, 60);
    await expect(verifySession('b'.repeat(32), token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    // Negative TTL → exp in the past. jose treats this as expired.
    const token = await signSession(SECRET, userFixture, -60);
    await expect(verifySession(SECRET, token)).rejects.toThrow();
  });

  it('rejects a tampered payload (modified single byte)', async () => {
    const token = await signSession(SECRET, userFixture, 60);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    // Flip a character in the payload chunk — signature now no longer matches.
    const tampered = `${parts[0]}.${parts[1]!.slice(0, -1)}X.${parts[2]}`;
    await expect(verifySession(SECRET, tampered)).rejects.toThrow();
  });

  it('rejects a malformed token', async () => {
    await expect(verifySession(SECRET, '')).rejects.toThrow();
    await expect(verifySession(SECRET, '.')).rejects.toThrow();
    await expect(verifySession(SECRET, 'a.b')).rejects.toThrow();
    await expect(verifySession(SECRET, 'a.b.c.d')).rejects.toThrow();
  });

  it('rejects an `alg: none` token (alg-confusion guard)', async () => {
    // Hand-craft an `alg: none` JWT — historically a critical JWT bypass when
    // libraries trust the header's alg field over the verification policy.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        uid: userFixture.id,
        did: userFixture.did,
        role: 'admin', // attempt to smuggle elevated role
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const evil = `${header}.${payload}.`;
    await expect(verifySession(SECRET, evil)).rejects.toThrow();
  });

  it('rejects a token signed with a different algorithm (HS512 vs pinned HS256)', async () => {
    const key = new TextEncoder().encode(SECRET);
    const wrongAlg = await new SignJWT({
      uid: userFixture.id,
      did: userFixture.did,
      role: 'admin', // attempt to smuggle elevated role
    })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(key);
    await expect(verifySession(SECRET, wrongAlg)).rejects.toThrow();
  });
});
