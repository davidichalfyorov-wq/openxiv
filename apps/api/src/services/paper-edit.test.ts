import { describe, expect, it } from 'vitest';
import { editPaperRequestSchema, __testing } from './paper-edit.js';

const { editablePaperFieldsSchema } = __testing;

describe('editablePaperFieldsSchema (immutable-field guard)', () => {
  it('accepts each editable field individually', () => {
    expect(editablePaperFieldsSchema.safeParse({ title: 'Updated title' }).success).toBe(true);
    expect(editablePaperFieldsSchema.safeParse({ abstract: 'New abstract' }).success).toBe(true);
    expect(editablePaperFieldsSchema.safeParse({ abstract: null }).success).toBe(true);
    expect(
      editablePaperFieldsSchema.safeParse({ keywords: ['a', 'b'] }).success,
    ).toBe(true);
    expect(
      editablePaperFieldsSchema.safeParse({ primaryCategory: 'cs.AI' }).success,
    ).toBe(true);
    expect(
      editablePaperFieldsSchema.safeParse({ crossListings: ['cs.LG', 'cs.CL'] }).success,
    ).toBe(true);
    expect(editablePaperFieldsSchema.safeParse({ license: 'CC-BY-4.0' }).success).toBe(true);
  });

  it('rejects unknown / immutable fields via .strict()', () => {
    for (const forbidden of [
      'openxivId',
      'submitterDid',
      'doi',
      'status',
      'createdAt',
      'updatedAt',
      'fileSha256',
      'role',
    ]) {
      const r = editablePaperFieldsSchema.safeParse({ [forbidden]: 'x' });
      expect(r.success, `${forbidden} must be rejected`).toBe(false);
    }
  });

  it('rejects max-5 cross-listings overflow', () => {
    const r = editablePaperFieldsSchema.safeParse({
      crossListings: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown category code in primaryCategory', () => {
    const r = editablePaperFieldsSchema.safeParse({ primaryCategory: 'made-up' });
    expect(r.success).toBe(false);
  });

  it('rejects license values not in the enum', () => {
    const r = editablePaperFieldsSchema.safeParse({ license: 'made-up' });
    expect(r.success).toBe(false);
  });
});

describe('editPaperRequestSchema (full request)', () => {
  it('requires a reason of at least 8 chars', () => {
    const r = editPaperRequestSchema.safeParse({
      reason: 'short',
      changes: { title: 'Updated' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty changes object', () => {
    const r = editPaperRequestSchema.safeParse({
      reason: 'Author requested a typo fix to the title',
      changes: {},
    });
    expect(r.success).toBe(false);
  });

  it('accepts a valid edit with reason + multiple field changes', () => {
    const r = editPaperRequestSchema.safeParse({
      reason: 'Cross-list math.ST per author request',
      changes: {
        crossListings: ['math'],
        keywords: ['statistics', 'preprint'],
      },
    });
    expect(r.success).toBe(true);
  });
});
