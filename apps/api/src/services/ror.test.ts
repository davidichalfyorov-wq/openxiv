import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalizeRorId } from './ror.js';

describe('canonicalizeRorId', () => {
  it('accepts a bare 9-char base32 id', () => {
    expect(canonicalizeRorId('00f54p054')).toBe('https://ror.org/00f54p054');
  });

  it('accepts the canonical https URL form', () => {
    expect(canonicalizeRorId('https://ror.org/00f54p054')).toBe(
      'https://ror.org/00f54p054',
    );
  });

  it('accepts http and no-scheme variants and normalises them', () => {
    expect(canonicalizeRorId('http://ror.org/00f54p054')).toBe(
      'https://ror.org/00f54p054',
    );
    expect(canonicalizeRorId('ror.org/00f54p054')).toBe(
      'https://ror.org/00f54p054',
    );
  });

  it('rejects ids with characters outside the ROR base32 alphabet', () => {
    // The letters l, i, o, u are not part of the alphabet.
    expect(canonicalizeRorId('00l54p054')).toBeNull();
    expect(canonicalizeRorId('00i54p054')).toBeNull();
    expect(canonicalizeRorId('00o54p054')).toBeNull();
    expect(canonicalizeRorId('00u54p054')).toBeNull();
  });

  it('rejects wrong-length ids', () => {
    expect(canonicalizeRorId('00f54p05')).toBeNull(); // 8 chars
    expect(canonicalizeRorId('00f54p0540')).toBeNull(); // 10 chars
    expect(canonicalizeRorId('')).toBeNull();
  });

  it('rejects junk', () => {
    expect(canonicalizeRorId('not-a-ror')).toBeNull();
    expect(canonicalizeRorId('https://google.com/ror.org/00f54p054')).toBeNull();
    expect(canonicalizeRorId('https://ror.org/00f54p054/extra')).toBeNull();
  });

  it('property: any 9-char base32 string is accepted', () => {
    const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
    fc.assert(
      fc.property(
        fc.tuple(
          ...Array.from({ length: 9 }, () =>
            fc.constantFrom(...alphabet.split('')),
          ),
        ),
        (chars) => {
          const id = chars.join('');
          expect(canonicalizeRorId(id)).toBe(`https://ror.org/${id}`);
        },
      ),
      { numRuns: 100 },
    );
  });
});
