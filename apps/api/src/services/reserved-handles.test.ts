import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  isReservedHandle,
  validateHandleShape,
  RESERVED_COUNT,
  __testing,
} from './reserved-handles.js';

describe('isReservedHandle', () => {
  it('matches the literal reserved entries', () => {
    expect(isReservedHandle('admin')).toBe(true);
    expect(isReservedHandle('api')).toBe(true);
    expect(isReservedHandle('mod')).toBe(true);
    expect(isReservedHandle('ddavidich')).toBe(true);
    expect(isReservedHandle('openxiv')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReservedHandle('ADMIN')).toBe(true);
    expect(isReservedHandle('Admin')).toBe(true);
    expect(isReservedHandle('aDmIn')).toBe(true);
  });

  it('strips whitespace and underscores for matching', () => {
    expect(isReservedHandle('a_d_m_i_n')).toBe(true);
    expect(isReservedHandle('mod')).toBe(true);
    expect(isReservedHandle('   admin   ')).toBe(true);
  });

  it('respects NFKC normalisation (e.g. fullwidth a → a)', () => {
    // ＡＤＭＩＮ uses fullwidth Latin letters; NFKC folds to ASCII.
    expect(isReservedHandle('ＡＤＭＩＮ')).toBe(true);
  });

  it('rejects ordinary user-like handles', () => {
    expect(isReservedHandle('alice')).toBe(false);
    expect(isReservedHandle('bob')).toBe(false);
    expect(isReservedHandle('researcher42')).toBe(false);
    expect(isReservedHandle('phys-grad')).toBe(false);
  });

  it('every raw reserved entry is in the set', () => {
    for (const raw of __testing.RESERVED_HANDLES_RAW) {
      expect(isReservedHandle(raw)).toBe(true);
    }
  });

  it('reserved set has the expected size (regression sentinel)', () => {
    // Bumping this is fine; just confirm no entry got dropped silently.
    expect(RESERVED_COUNT).toBeGreaterThanOrEqual(80);
  });
});

describe('validateHandleShape', () => {
  it('accepts a vanilla handle', () => {
    const r = validateHandleShape('alice');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.handle).toBe('alice');
  });

  it('accepts mixed-case input and lowercases it', () => {
    const r = validateHandleShape('AlicE');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.handle).toBe('alice');
  });

  it('rejects too short', () => {
    const r = validateHandleShape('ab');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_short');
  });

  it('rejects too long', () => {
    const r = validateHandleShape('a'.repeat(31));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_long');
  });

  it('rejects DID-shaped strings', () => {
    expect(validateHandleShape('did:plc:abc')).toMatchObject({ ok: false, reason: 'did_shape' });
    expect(validateHandleShape('did%3aplc')).toMatchObject({ ok: false, reason: 'did_shape' });
  });

  it('rejects all-numeric handles', () => {
    expect(validateHandleShape('12345')).toMatchObject({ ok: false, reason: 'all_numeric' });
  });

  it('rejects starting/ending with separators', () => {
    expect(validateHandleShape('-abc')).toMatchObject({ ok: false, reason: 'invalid_chars' });
    expect(validateHandleShape('abc-')).toMatchObject({ ok: false, reason: 'invalid_chars' });
    expect(validateHandleShape('.abc')).toMatchObject({ ok: false, reason: 'invalid_chars' });
  });

  it('rejects non-ASCII characters', () => {
    expect(validateHandleShape('алиса')).toMatchObject({ ok: false, reason: 'invalid_chars' });
    expect(validateHandleShape('alice.с')).toMatchObject({ ok: false, reason: 'invalid_chars' });
  });

  it('rejects reserved names', () => {
    expect(validateHandleShape('admin')).toMatchObject({ ok: false, reason: 'reserved' });
    expect(validateHandleShape('openxiv')).toMatchObject({ ok: false, reason: 'reserved' });
  });

  it('property: random ASCII alnum 3..30 starting+ending with alnum is accepted (unless reserved)', () => {
    fc.assert(
      fc.property(
        fc
          .stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789._-'.split('')),
            { minLength: 1, maxLength: 28 },
          )
          .filter((middle) => !/^[._-]|[._-]$/.test(middle))
          .map((middle) => `a${middle}z`),
        (s) => {
          const r = validateHandleShape(s);
          if (!r.ok) {
            // Acceptable failures: reserved + all_numeric (which can't happen here because we wrap with 'a' and 'z').
            expect(['reserved']).toContain(r.reason);
          } else {
            expect(r.handle).toBe(s.toLowerCase());
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
