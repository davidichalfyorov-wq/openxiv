import { describe, expect, it } from 'vitest';
import {
  ATTESTATION_VALUE,
  LEX_IDS,
  PREPRINT_LEX_ID,
  disclosureRecordSchema,
  paperRecordSchema,
  preprintRecordSchema,
  postRecordSchema,
  safeValidateRecord,
  summaryRecordSchema,
  validateRecord,
} from './index.js';

const now = '2026-05-17T12:00:00.000Z';

describe('paperRecordSchema', () => {
  it('accepts a minimal valid paper', () => {
    const parsed = paperRecordSchema.parse({
      title: 'On the dynamics of testing',
      authors: [{ displayName: 'A. Author' }],
      categories: ['cs.AI'],
      license: 'CC-BY-4.0',
      createdAt: now,
    });
    expect(parsed.title).toBe('On the dynamics of testing');
  });

  it('rejects when title is too short', () => {
    expect(() =>
      paperRecordSchema.parse({
        title: 'hi',
        authors: [{ displayName: 'A' }],
        categories: ['cs.AI'],
        license: 'CC-BY-4.0',
        createdAt: now,
      }),
    ).toThrow();
  });

  it('rejects unknown license', () => {
    expect(() =>
      paperRecordSchema.parse({
        title: 'A valid title',
        authors: [{ displayName: 'A' }],
        categories: ['cs.AI'],
        license: 'MIT',
        createdAt: now,
      }),
    ).toThrow();
  });
});

describe('preprintRecordSchema', () => {
  it('accepts the compatibility preprint collection with paper metadata', () => {
    const parsed = preprintRecordSchema.parse({
      $type: PREPRINT_LEX_ID,
      title: 'On the dynamics of testing',
      authors: [{ displayName: 'A. Author' }],
      categories: ['cs.AI'],
      primaryCategory: 'cs.AI',
      crossListings: [],
      license: 'CC-BY-4.0',
      createdAt: now,
    });

    expect(parsed.$type).toBe(PREPRINT_LEX_ID);
    expect(parsed.title).toBe('On the dynamics of testing');
  });
});

describe('summaryRecordSchema', () => {
  it('accepts a valid summary at undergrad tier', () => {
    const parsed = summaryRecordSchema.parse({
      paperUri: 'at://did:plc:abcdefghijklmnopqrstuvwx/app.openxiv.paper/3kabcdef12345',
      tier: 'undergrad',
      text: 'a'.repeat(200),
      createdAt: now,
    });
    expect(parsed.tier).toBe('undergrad');
  });

  it('rejects too-short text', () => {
    expect(() =>
      summaryRecordSchema.parse({
        paperUri: 'at://did:plc:abcdefghijklmnopqrstuvwx/app.openxiv.paper/3kabcdef12345',
        tier: 'school',
        text: 'too short',
        createdAt: now,
      }),
    ).toThrow();
  });
});

describe('disclosureRecordSchema', () => {
  const baseUri = 'at://did:plc:abcdefghijklmnopqrstuvwx/app.openxiv.paper/3kabcdef12345';

  it('accepts a "none" disclosure', () => {
    const parsed = disclosureRecordSchema.parse({
      paperUri: baseUri,
      level: 'none',
      attestation: ATTESTATION_VALUE,
      createdAt: now,
    });
    expect(parsed.level).toBe('none');
  });

  it('rejects "none" with non-empty aiUsed', () => {
    expect(() =>
      disclosureRecordSchema.parse({
        paperUri: baseUri,
        level: 'none',
        aiUsed: ['writing'],
        attestation: ATTESTATION_VALUE,
        createdAt: now,
      }),
    ).toThrow();
  });

  it('rejects "assistant" without aiUsed or models', () => {
    expect(() =>
      disclosureRecordSchema.parse({
        paperUri: baseUri,
        level: 'assistant',
        attestation: ATTESTATION_VALUE,
        createdAt: now,
      }),
    ).toThrow();
  });

  it('accepts a valid "coauthor" disclosure', () => {
    const parsed = disclosureRecordSchema.parse({
      paperUri: baseUri,
      level: 'coauthor',
      aiUsed: ['derivation', 'writing'],
      models: [{ name: 'gemini-2.5-flash', vendor: 'google', usage: 'writing' }],
      attestation: ATTESTATION_VALUE,
      createdAt: now,
    });
    expect(parsed.aiUsed).toEqual(['derivation', 'writing']);
  });
});

describe('postRecordSchema', () => {
  it('accepts a minimal post', () => {
    const parsed = postRecordSchema.parse({
      text: 'hello, science social',
      createdAt: now,
    });
    expect(parsed.text).toBe('hello, science social');
  });

  it('rejects empty text', () => {
    expect(() =>
      postRecordSchema.parse({ text: '', createdAt: now }),
    ).toThrow();
  });
});

describe('registry', () => {
  it('includes the compatibility preprint lexicon id', () => {
    expect(LEX_IDS).toContain(PREPRINT_LEX_ID);
  });

  it('validates compatibility preprint records by lexId', () => {
    const result = validateRecord(PREPRINT_LEX_ID, {
      title: 'A compatible preprint record',
      authors: [{ displayName: 'A. Author' }],
      categories: ['cs.AI'],
      license: 'CC-BY-4.0',
      createdAt: now,
    });

    expect(result.title).toBe('A compatible preprint record');
  });

  it('validateRecord routes by lexId', () => {
    const result = validateRecord('app.openxiv.summary', {
      paperUri: 'at://did:plc:abcdefghijklmnopqrstuvwx/app.openxiv.paper/3kabcdef12345',
      tier: 'expert',
      text: 'a'.repeat(120),
      createdAt: now,
    });
    expect(result.tier).toBe('expert');
  });

  it('safeValidateRecord returns failure on bad input', () => {
    const result = safeValidateRecord('app.openxiv.post', { text: '' });
    expect(result.success).toBe(false);
  });
});
