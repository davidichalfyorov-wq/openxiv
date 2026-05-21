import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  base58btcDecode,
  base58btcEncode,
  decryptPrivateKey,
  encryptPrivateKey,
  generateKeypair,
  loadKekFromEnv,
  multibaseToPubkey,
  __testing,
} from './user-keys.js';

const VALID_KEK_BASE64 = Buffer.from(new Uint8Array(32).fill(0xab)).toString('base64');

describe('loadKekFromEnv', () => {
  const original = process.env['OPENXIV_KEK_BASE64'];
  beforeEach(() => {
    delete process.env['OPENXIV_KEK_BASE64'];
  });
  afterEach(() => {
    if (original !== undefined) process.env['OPENXIV_KEK_BASE64'] = original;
    else delete process.env['OPENXIV_KEK_BASE64'];
  });

  it('throws when env missing', () => {
    expect(() => loadKekFromEnv()).toThrow(/OPENXIV_KEK_BASE64 is not set/);
  });
  it('throws on wrong length', () => {
    process.env['OPENXIV_KEK_BASE64'] = Buffer.alloc(16).toString('base64');
    expect(() => loadKekFromEnv()).toThrow(/must decode to 32 bytes/);
  });
  it('returns 32 bytes on valid input', () => {
    process.env['OPENXIV_KEK_BASE64'] = VALID_KEK_BASE64;
    const k = loadKekFromEnv();
    expect(k.length).toBe(32);
  });
});

describe('generateKeypair', () => {
  it('produces 32-byte private + 33-byte compressed public', () => {
    const k = generateKeypair();
    expect(k.privateKey.length).toBe(32);
    expect(k.publicKey.length).toBe(33);
    expect(k.multibase.startsWith('z')).toBe(true);
  });
  it('100 generations all distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const k = generateKeypair();
      seen.add(k.multibase);
    }
    expect(seen.size).toBe(100);
  });
});

describe('multibase pubkey codec', () => {
  it('round-trips secp256k1 pubkey', () => {
    const { publicKey, multibase } = generateKeypair();
    const decoded = multibaseToPubkey(multibase);
    expect(Buffer.from(decoded)).toEqual(Buffer.from(publicKey));
  });
  it('rejects non-z multibase strings', () => {
    expect(() => multibaseToPubkey('xnope')).toThrow();
  });
});

describe('base58btc codec', () => {
  it('round-trips 0..256 random byte sequences', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (bytes) => {
        const enc = base58btcEncode(bytes);
        const dec = base58btcDecode(enc);
        expect(Buffer.from(dec)).toEqual(Buffer.from(bytes));
      }),
      { numRuns: 100 },
    );
  });
  it('handles leading zeros', () => {
    const bytes = new Uint8Array([0, 0, 0, 1, 2, 3]);
    const enc = base58btcEncode(bytes);
    const dec = base58btcDecode(enc);
    expect(Buffer.from(dec)).toEqual(Buffer.from(bytes));
  });
});

describe('encrypt/decrypt private key', () => {
  it('round-trips a 32-byte key', () => {
    const kek = new Uint8Array(32).fill(0xab);
    const { privateKey } = generateKeypair();
    const { ciphertext, nonce } = encryptPrivateKey(privateKey, kek);
    expect(nonce.length).toBe(24);
    expect(ciphertext.length).toBeGreaterThanOrEqual(32 + 16); // priv + Poly1305 tag
    const back = decryptPrivateKey(ciphertext, nonce, kek);
    expect(Buffer.from(back)).toEqual(Buffer.from(privateKey));
  });

  it('different nonces produce different ciphertexts for same priv/kek', () => {
    const kek = new Uint8Array(32).fill(0x77);
    const { privateKey } = generateKeypair();
    const a = encryptPrivateKey(privateKey, kek);
    const b = encryptPrivateKey(privateKey, kek);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it('decrypt fails on a corrupted KEK', () => {
    const kek = new Uint8Array(32).fill(0x33);
    const { privateKey } = generateKeypair();
    const { ciphertext, nonce } = encryptPrivateKey(privateKey, kek);
    const bad = new Uint8Array(32).fill(0x44);
    expect(() => decryptPrivateKey(ciphertext, nonce, bad)).toThrow();
  });

  it('rejects nonces that are the wrong length', () => {
    const kek = new Uint8Array(32);
    expect(() =>
      decryptPrivateKey(new Uint8Array(48), new Uint8Array(12), kek),
    ).toThrow(/24-byte nonce/);
  });

  it('rejects KEKs that are the wrong length', () => {
    const priv = new Uint8Array(32);
    expect(() => encryptPrivateKey(priv, new Uint8Array(16))).toThrow(/KEK/);
  });
});

void __testing;
