import { describe, expect, it } from 'vitest';
import { generateKeypair } from '../services/user-keys.js';
import { __testing } from './did-web.js';

const { buildUserDidDoc, buildOrgDidDoc, SUBJECT_RE } = __testing;

describe('buildUserDidDoc', () => {
  const base = {
    canonicalDid: 'did:web:openxiv.net:u:orcid.0009-0003-6027-7837',
    publicBase: 'https://openxiv.net',
    handle: 'ddavidich',
    publicSigningKey: 'zPubKey1',
    retiredPubkeys: [],
  };

  it('emits the expected top-level shape', () => {
    const doc = buildUserDidDoc(base);
    expect((doc as { id: string }).id).toBe(base.canonicalDid);
    expect(Array.isArray((doc as { '@context': unknown[] })['@context'])).toBe(true);
    expect((doc as { service: unknown[] }).service.length).toBeGreaterThan(0);
  });

  it('serialises the active verificationMethod as Multikey', () => {
    const doc = buildUserDidDoc(base);
    const vm = (doc as { verificationMethod: Array<Record<string, unknown>> }).verificationMethod;
    expect(vm).toHaveLength(1);
    expect(vm[0]).toMatchObject({
      id: `${base.canonicalDid}#atproto`,
      type: 'Multikey',
      controller: base.canonicalDid,
      publicKeyMultibase: 'zPubKey1',
    });
  });

  it('includes retired keys with stable index ids', () => {
    const doc = buildUserDidDoc({
      ...base,
      retiredPubkeys: [
        { multibase: 'zRetA', retiredAt: '2026-01-01T00:00:00Z', reason: 'rotation' },
        { multibase: 'zRetB', retiredAt: '2026-02-01T00:00:00Z', reason: 'manual' },
      ],
    });
    const vm = (doc as { verificationMethod: Array<Record<string, unknown>> }).verificationMethod;
    expect(vm).toHaveLength(3);
    expect(vm[1]!['id']).toBe(`${base.canonicalDid}#retired-0`);
    expect(vm[2]!['id']).toBe(`${base.canonicalDid}#retired-1`);
    expect(vm[1]!['publicKeyMultibase']).toBe('zRetA');
  });

  it('alsoKnownAs uses /@handle when set, and /u/subject as fallback', () => {
    const doc = buildUserDidDoc(base);
    expect((doc as { alsoKnownAs: string[] }).alsoKnownAs).toContain(
      'https://openxiv.net/@ddavidich',
    );
    const noHandle = buildUserDidDoc({ ...base, handle: null });
    const aka = (noHandle as { alsoKnownAs: string[] }).alsoKnownAs;
    expect(aka.some((s) => s.includes('/u/orcid.0009-0003-6027-7837'))).toBe(true);
  });

  it('authentication/assertionMethod only references the ACTIVE key', () => {
    const doc = buildUserDidDoc({
      ...base,
      retiredPubkeys: [{ multibase: 'zRetA', retiredAt: '2026-01-01T00:00:00Z', reason: 'rotation' }],
    });
    expect((doc as { authentication: string[] }).authentication).toEqual([
      `${base.canonicalDid}#atproto`,
    ]);
    expect((doc as { assertionMethod: string[] }).assertionMethod).toEqual([
      `${base.canonicalDid}#atproto`,
    ]);
  });

  it('omits authentication when no active key', () => {
    const doc = buildUserDidDoc({ ...base, publicSigningKey: null });
    expect((doc as { authentication: string[] }).authentication).toEqual([]);
  });
});

describe('buildOrgDidDoc', () => {
  it('includes the App View service block', () => {
    const doc = buildOrgDidDoc({ publicBase: 'https://openxiv.net' });
    expect((doc as { id: string }).id).toBe('did:web:openxiv.net');
    const services = (doc as { service: Array<Record<string, unknown>> }).service;
    expect(services.some((s) => s['type'] === 'OpenXivAppView')).toBe(true);
  });

  it('publishes the configured service signing key for Trust Passport verification', () => {
    const prev = process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
    const keypair = generateKeypair();
    try {
      process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = Buffer.from(keypair.privateKey).toString(
        'base64',
      );
      const doc = buildOrgDidDoc({ publicBase: 'https://openxiv.net' });
      const methods = (doc as { verificationMethod: Array<Record<string, unknown>> })
        .verificationMethod;
      expect(methods[0]).toMatchObject({
        id: 'did:web:openxiv.net#atproto',
        type: 'Multikey',
        controller: 'did:web:openxiv.net',
        publicKeyMultibase: keypair.multibase,
      });
    } finally {
      if (prev === undefined) delete process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'];
      else process.env['OPENXIV_SERVICE_PRIVATE_KEY_BASE64'] = prev;
    }
  });
});

describe('SUBJECT_RE', () => {
  it('matches well-formed subjects', () => {
    expect(SUBJECT_RE.test('orcid.0009-0003-6027-7837')).toBe(true);
    expect(SUBJECT_RE.test('google.123456789')).toBe(true);
  });
  it('rejects DIDs and percent-encoded inputs', () => {
    expect(SUBJECT_RE.test('did:plc:abc')).toBe(false);
    expect(SUBJECT_RE.test('did%3Aplc%3Aabc')).toBe(false);
    expect(SUBJECT_RE.test('o')).toBe(false);
  });
});
