import { describe, expect, it } from 'vitest';
import { __testing, projectDidDoc, didWebToUrl } from './bluesky-did-resolver.js';

describe('projectDidDoc', () => {
  it('extracts the #atproto verificationMethod multibase', () => {
    const doc = {
      verificationMethod: [
        {
          id: 'did:plc:abc#atproto',
          type: 'Multikey',
          publicKeyMultibase: 'zMain',
        },
      ],
    };
    expect(projectDidDoc(doc)).toEqual({ signingKey: 'zMain', pdsEndpoint: null });
  });

  it('falls back to first multibase if no #atproto match', () => {
    const doc = {
      verificationMethod: [
        { id: '#weird', publicKeyMultibase: 'zFallback' },
      ],
    };
    expect(projectDidDoc(doc)).toEqual({ signingKey: 'zFallback', pdsEndpoint: null });
  });

  it('extracts AtprotoPersonalDataServer endpoint', () => {
    const doc = {
      verificationMethod: [],
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: 'https://pds.example.com',
        },
      ],
    };
    expect(projectDidDoc(doc)).toEqual({
      signingKey: null,
      pdsEndpoint: 'https://pds.example.com',
    });
  });

  it('returns nulls when no verificationMethod or service', () => {
    expect(projectDidDoc({})).toEqual({ signingKey: null, pdsEndpoint: null });
  });

  it('ignores entries with non-string fields', () => {
    const doc = {
      verificationMethod: [{ id: 123, publicKeyMultibase: 456 }],
      service: [{ id: null, type: undefined, serviceEndpoint: true }],
    };
    expect(projectDidDoc(doc as Record<string, unknown>)).toEqual({
      signingKey: null,
      pdsEndpoint: null,
    });
  });
});

describe('didWebToUrl', () => {
  it('maps host-only did:web', () => {
    expect(didWebToUrl('did:web:openxiv.net')).toBe('https://openxiv.net/.well-known/did.json');
  });
  it('maps did:web with path segments', () => {
    expect(didWebToUrl('did:web:openxiv.net:u:orcid.0009')).toBe(
      'https://openxiv.net/u/orcid.0009/did.json',
    );
  });
  it('returns null for non-did:web inputs', () => {
    expect(didWebToUrl('did:plc:abc')).toBeNull();
    expect(didWebToUrl('http://example.com')).toBeNull();
  });
});

void __testing;
