import { Errors, type AppResultAsync, ResultAsync } from '@openxiv/shared';
import { getPublicKey, utils as secpUtils } from '@noble/secp256k1';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { AppContext } from '../context.js';
import type { RetiredPubkeyEntry } from '@openxiv/db';

/**
 * Per-user signing key management for did:web users.
 *
 * Responsibilities:
 *   1. Generate fresh secp256k1 keypairs on demand.
 *   2. Encrypt private keys with XChaCha20-Poly1305 under the env KEK and
 *      persist on the user row.
 *   3. Decrypt on demand for signing operations (NOT for read-only API
 *      requests — only when the user actively signs an AT-proto record).
 *   4. Rotate: generate new keypair, archive old pubkey into
 *      `retired_pubkeys` so signatures already in the wild keep verifying
 *      until manually purged.
 *
 * Strict invariants:
 *   - The KEK is read from `OPENXIV_KEK_BASE64` on each operation; we
 *     deliberately don't memoise it so a misconfiguration fails closed
 *     rather than silently using a stale key.
 *   - The private key never leaves this module's surface; the only
 *     consumer of `decryptPrivateKey` is the (yet-to-land) PDS-side
 *     signing path. The API never returns private-key material to clients.
 *   - All crypto routes through `@noble/*` (audited libraries); no
 *     hand-rolled primitives.
 */

const KEY_TYPE = 'secp256k1' as const;
const KEK_BYTES = 32;
const NONCE_BYTES = 24;
const PUBKEY_COMPRESSED_BYTES = 33;
const PRIVKEY_BYTES = 32;

/** Multikey codec prefix for compressed secp256k1 (k256-pub: 0xe7, 0x01). */
const SECP256K1_PUB_PREFIX = new Uint8Array([0xe7, 0x01]);

export interface UserKeysService {
  loadKek(): Uint8Array;
  generateKeypair(): GeneratedKeypair;
  encryptPrivateKey(
    priv: Uint8Array,
    kek: Uint8Array,
  ): { ciphertext: Uint8Array; nonce: Uint8Array };
  decryptPrivateKey(ciphertext: Uint8Array, nonce: Uint8Array, kek: Uint8Array): Uint8Array;
  /**
   * Idempotent: bootstrap a user's keypair if missing. No-op when one
   * already exists. Returns the multibase pubkey either way.
   */
  ensureKeypair(userId: string): AppResultAsync<{ rotated: boolean; publicMultibase: string }>;
  /**
   * Rotate: generate a fresh keypair. Old pubkey moves into
   * `retired_pubkeys` so signatures issued under it still verify against
   * the published DID Document until a maintenance purge.
   */
  rotateKeypair(
    userId: string,
    reason: 'rotation' | 'compromise' | 'manual',
  ): AppResultAsync<{ newPublicMultibase: string; retired: RetiredPubkeyEntry[] }>;
  /**
   * Lookup the active public key + retired entries for a user, formatted
   * for inclusion in the DID Document. Never returns private-key material.
   */
  getVerificationMethods(userId: string): AppResultAsync<VerificationMethodSet>;
}

export interface GeneratedKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  multibase: string;
}

export interface VerificationMethodSet {
  active: { multibase: string; createdAt: string } | null;
  retired: RetiredPubkeyEntry[];
}

export function makeUserKeysService(ctx: AppContext): UserKeysService {
  const { users } = ctx.repos;

  return {
    loadKek() {
      return loadKekFromEnv();
    },
    generateKeypair() {
      return generateKeypair();
    },
    encryptPrivateKey(priv, kek) {
      return encryptPrivateKey(priv, kek);
    },
    decryptPrivateKey(ciphertext, nonce, kek) {
      return decryptPrivateKey(ciphertext, nonce, kek);
    },
    ensureKeypair(userId) {
      return users.findById(userId).andThen((user) => {
        if (!user) {
          return ResultAsync.fromPromise(
            Promise.reject(new Error(`user ${userId}`)),
            () => Errors.notFound(`user ${userId}`),
          );
        }
        if (user.publicSigningKey) {
          return ResultAsync.fromSafePromise(
            Promise.resolve({ rotated: false, publicMultibase: user.publicSigningKey }),
          );
        }
        const kek = loadKekFromEnv();
        const kp = generateKeypair();
        const { ciphertext, nonce } = encryptPrivateKey(kp.privateKey, kek);
        return users
          .setKeys({
            id: userId,
            publicSigningKey: kp.multibase,
            encryptedSigningKey: Buffer.from(ciphertext),
            signingKeyNonce: Buffer.from(nonce),
            keyType: KEY_TYPE,
          })
          .map(() => ({ rotated: true, publicMultibase: kp.multibase }));
      });
    },
    rotateKeypair(userId, reason) {
      return users.findById(userId).andThen((user) => {
        if (!user) {
          return ResultAsync.fromPromise(
            Promise.reject(new Error(`user ${userId}`)),
            () => Errors.notFound(`user ${userId}`),
          );
        }
        const kek = loadKekFromEnv();
        const kp = generateKeypair();
        const { ciphertext, nonce } = encryptPrivateKey(kp.privateKey, kek);
        const retired: RetiredPubkeyEntry[] = [...(user.retiredPubkeys ?? [])];
        if (user.publicSigningKey) {
          retired.push({
            multibase: user.publicSigningKey,
            retiredAt: new Date().toISOString(),
            reason,
          });
        }
        return users
          .setKeys({
            id: userId,
            publicSigningKey: kp.multibase,
            encryptedSigningKey: Buffer.from(ciphertext),
            signingKeyNonce: Buffer.from(nonce),
            keyType: KEY_TYPE,
          })
          .andThen(() => users.setRetiredPubkeys(userId, retired))
          .map(() => ({ newPublicMultibase: kp.multibase, retired }));
      });
    },
    getVerificationMethods(userId) {
      return users.findById(userId).map((user) => {
        if (!user) return { active: null, retired: [] };
        const active = user.publicSigningKey
          ? { multibase: user.publicSigningKey, createdAt: user.createdAt.toISOString() }
          : null;
        return { active, retired: user.retiredPubkeys ?? [] };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests.
// ---------------------------------------------------------------------------

export function loadKekFromEnv(): Uint8Array {
  const raw = process.env['OPENXIV_KEK_BASE64'];
  if (!raw) {
    throw new Error(
      'OPENXIV_KEK_BASE64 is not set. Generate a 32-byte key and place it in your secret manager.',
    );
  }
  let buf: Uint8Array;
  try {
    buf = new Uint8Array(Buffer.from(raw, 'base64'));
  } catch {
    throw new Error('OPENXIV_KEK_BASE64 is not valid base64');
  }
  if (buf.length !== KEK_BYTES) {
    throw new Error(`OPENXIV_KEK_BASE64 must decode to ${KEK_BYTES} bytes, got ${buf.length}`);
  }
  return buf;
}

export function generateKeypair(): GeneratedKeypair {
  // @noble/secp256k1 v3 renamed randomPrivateKey → randomSecretKey. Fall
  // back to the old name if running against an older version (we pin v3,
  // but library updates shouldn't break the build retroactively).
  const utilsAny = secpUtils as unknown as {
    randomSecretKey?: () => Uint8Array;
    randomPrivateKey?: () => Uint8Array;
  };
  const gen = utilsAny.randomSecretKey ?? utilsAny.randomPrivateKey;
  if (!gen) throw new Error('noble/secp256k1: no randomSecretKey/randomPrivateKey export');
  const privateKey = gen();
  // Compressed pubkey (33 bytes) is the AT-proto canonical form.
  const publicKey = getPublicKey(privateKey, true);
  if (publicKey.length !== PUBKEY_COMPRESSED_BYTES) {
    throw new Error(`unexpected pubkey length: ${publicKey.length}`);
  }
  return { privateKey, publicKey, multibase: pubkeyToMultibase(publicKey) };
}

export function pubkeyToMultibase(pub: Uint8Array): string {
  // Multikey envelope = multicodec varint prefix || raw bytes, then
  // base58btc the whole thing and prepend 'z'.
  const framed = new Uint8Array(SECP256K1_PUB_PREFIX.length + pub.length);
  framed.set(SECP256K1_PUB_PREFIX);
  framed.set(pub, SECP256K1_PUB_PREFIX.length);
  return 'z' + base58btcEncode(framed);
}

export function multibaseToPubkey(mb: string): Uint8Array {
  if (!mb.startsWith('z')) throw new Error('not a base58btc multibase string');
  const decoded = base58btcDecode(mb.slice(1));
  if (decoded.length < SECP256K1_PUB_PREFIX.length + 1) {
    throw new Error('multibase payload too short');
  }
  if (decoded[0] !== SECP256K1_PUB_PREFIX[0] || decoded[1] !== SECP256K1_PUB_PREFIX[1]) {
    throw new Error('multikey prefix is not secp256k1');
  }
  return decoded.slice(SECP256K1_PUB_PREFIX.length);
}

export function encryptPrivateKey(
  priv: Uint8Array,
  kek: Uint8Array,
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  if (priv.length !== PRIVKEY_BYTES) {
    throw new Error(`expected ${PRIVKEY_BYTES}-byte private key, got ${priv.length}`);
  }
  if (kek.length !== KEK_BYTES) {
    throw new Error(`expected ${KEK_BYTES}-byte KEK, got ${kek.length}`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(kek, nonce);
  const ciphertext = cipher.encrypt(priv);
  return { ciphertext, nonce };
}

export function decryptPrivateKey(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  kek: Uint8Array,
): Uint8Array {
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`expected ${NONCE_BYTES}-byte nonce, got ${nonce.length}`);
  }
  const cipher = xchacha20poly1305(kek, nonce);
  return cipher.decrypt(ciphertext);
}

// ---------------------------------------------------------------------------
// Minimal base58btc codec. Inlined to avoid a tiny runtime dep — the
// alternatives all transitively bring polyfills we don't need.
// ---------------------------------------------------------------------------
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_DECODE: Record<string, number> = {};
for (let i = 0; i < B58_ALPHABET.length; i++) B58_DECODE[B58_ALPHABET[i]!] = i;

export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const size = ((bytes.length - zeros) * 138) / 100 + 1; // log(256)/log(58)
  const b58 = new Uint8Array(Math.floor(size));
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    let j = 0;
    for (let it = b58.length - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
      carry += 256 * b58[it]!;
      b58[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let it = b58.length - length;
  while (it < b58.length && b58[it] === 0) it++;
  let out = '1'.repeat(zeros);
  for (; it < b58.length; it++) out += B58_ALPHABET[b58[it]!];
  return out;
}

export function base58btcDecode(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const size = ((s.length - zeros) * 733) / 1000 + 1;
  const b256 = new Uint8Array(Math.floor(size));
  let length = 0;
  for (let i = zeros; i < s.length; i++) {
    const v = B58_DECODE[s[i]!];
    if (v === undefined) throw new Error(`invalid base58 character: ${s[i]}`);
    let carry = v;
    let j = 0;
    for (let it = b256.length - 1; (carry !== 0 || j < length) && it >= 0; it--, j++) {
      carry += 58 * b256[it]!;
      b256[it] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = j;
  }
  let it = b256.length - length;
  while (it < b256.length && b256[it] === 0) it++;
  const out = new Uint8Array(zeros + (b256.length - it));
  for (let i = 0; i < zeros; i++) out[i] = 0;
  for (let i = zeros; it < b256.length; i++, it++) out[i] = b256[it]!;
  return out;
}

export const __testing = {
  loadKekFromEnv,
  generateKeypair,
  encryptPrivateKey,
  decryptPrivateKey,
  pubkeyToMultibase,
  multibaseToPubkey,
  base58btcEncode,
  base58btcDecode,
};
