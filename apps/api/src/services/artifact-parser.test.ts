import { describe, expect, it } from 'vitest';
import { __testing } from './artifact-parser.js';

const { parseArtifactBody, parseCff } = __testing;

describe('parseArtifactBody — codemeta JSON', () => {
  it('extracts the well-known top-level fields', () => {
    const body = JSON.stringify({
      '@context': 'https://w3id.org/codemeta/3.0',
      '@type': 'SoftwareSourceCode',
      name: 'openxiv-bridge',
      description: 'a tiny bridge',
      license: 'MIT',
      codeRepository: 'https://github.com/openxiv/bridge',
      programmingLanguage: 'TypeScript',
      author: [{ '@type': 'Person', name: 'A. Author' }],
    });
    const out = parseArtifactBody({
      type: 'codemeta',
      contentType: 'application/json',
      body,
    });
    expect(out.type).toBe('codemeta');
    expect(out.metadata).toMatchObject({
      name: 'openxiv-bridge',
      license: 'MIT',
      codeRepository: 'https://github.com/openxiv/bridge',
    });
    // Author is not in our projection — we keep it lean.
    expect(out.metadata?.['author']).toBeUndefined();
  });

  it('returns null metadata when JSON is malformed', () => {
    const out = parseArtifactBody({
      type: 'codemeta',
      contentType: 'application/json',
      body: 'not json',
    });
    expect(out.metadata).toBeNull();
  });

  it('promotes inferred SoftwareSourceCode JSON to type=codemeta even when caller declared other', () => {
    const body = JSON.stringify({ '@type': 'SoftwareSourceCode', name: 'x' });
    const out = parseArtifactBody({
      type: 'other',
      contentType: 'application/json',
      body,
    });
    expect(out.type).toBe('codemeta');
  });
});

describe('parseCff — minimal YAML subset', () => {
  it('extracts the canonical CFF fields', () => {
    const cff = `cff-version: 1.2.0
message: "If you use this, please cite"
title: openxiv-bridge
abstract: A small bridge
version: 0.1.0
doi: 10.5281/zenodo.999999
license: MIT
repository-code: https://github.com/openxiv/bridge`;
    expect(parseCff(cff)).toEqual({
      'cff-version': '1.2.0',
      message: 'If you use this, please cite',
      title: 'openxiv-bridge',
      abstract: 'A small bridge',
      version: '0.1.0',
      doi: '10.5281/zenodo.999999',
      license: 'MIT',
      'repository-code': 'https://github.com/openxiv/bridge',
    });
  });

  it('returns an empty object for non-CFF text', () => {
    expect(parseCff('hello world')).toEqual({});
    expect(parseCff('')).toEqual({});
  });

  it('promotes type=cff when the body has a cff-version line', () => {
    const out = parseArtifactBody({
      type: 'other',
      contentType: 'text/yaml',
      body: 'cff-version: 1.2.0\ntitle: x',
    });
    expect(out.type).toBe('cff');
  });
});
