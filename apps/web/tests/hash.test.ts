import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/lib/hash.js';

/**
 * SHA-256 known-answer vectors from NIST FIPS 180-4 examples + a few
 * email-shaped inputs to lock in the lowercase + trim normalisation
 * that Twitter Ads expects.
 */

describe('sha256Hex (email normalisation)', () => {
  it('matches the known vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a typical email address', async () => {
    // Computed via `echo -n alice@example.com | sha256sum` — the
    // matching SHA-256 of the normalised input. Locked here so a
    // future refactor of the normalisation pipeline can't silently
    // shift the digest.
    expect(await sha256Hex('alice@example.com')).toBe(
      'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976',
    );
  });

  it('lowercases the address before hashing', async () => {
    const upper = await sha256Hex('ALICE@example.com');
    const lower = await sha256Hex('alice@example.com');
    expect(upper).toBe(lower);
  });

  it('trims whitespace before hashing', async () => {
    const padded = await sha256Hex('   alice@example.com\n');
    const clean = await sha256Hex('alice@example.com');
    expect(padded).toBe(clean);
  });

  it('mixed case + whitespace converge', async () => {
    const dirty = await sha256Hex(' Alice@Example.COM  ');
    const clean = await sha256Hex('alice@example.com');
    expect(dirty).toBe(clean);
  });

  it('throws on empty input after trim', async () => {
    await expect(sha256Hex('')).rejects.toThrow(/empty/i);
    await expect(sha256Hex('   ')).rejects.toThrow(/empty/i);
  });

  it('throws when not a string', async () => {
    // @ts-expect-error: intentional bad input
    await expect(sha256Hex(null)).rejects.toThrow();
    // @ts-expect-error: intentional bad input
    await expect(sha256Hex(42)).rejects.toThrow();
  });
});
