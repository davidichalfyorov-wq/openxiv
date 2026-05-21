import { createHash, randomBytes } from 'node:crypto';

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

/**
 * Generate an AT-proto-style TID (timestamp identifier). 13 base32-sortable chars.
 * Encodes microseconds since epoch + clock id for monotonicity.
 *
 * Implementation follows the reference algorithm in @atproto/common but is
 * inlined here to avoid pulling in @atproto/common's heavy peer deps.
 */
let lastTimestamp = 0n;
let clockId: bigint | null = null;

export function generateTid(): string {
  if (clockId === null) {
    clockId = BigInt(Math.floor(Math.random() * 1024));
  }
  let micros = BigInt(Date.now()) * 1000n;
  if (micros <= lastTimestamp) {
    micros = lastTimestamp + 1n;
  }
  lastTimestamp = micros;
  const value = (micros << 10n) | clockId;
  return s32encode(value);
}

function s32encode(value: bigint): string {
  let v = value;
  const out: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    const idx = Number(v & 0x1fn);
    out.unshift(TID_ALPHABET[idx]!);
    v >>= 5n;
  }
  return out.join('');
}

/** Compose an at-uri. */
export function makeAtUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`;
}

/** Parse an at-uri into its parts. Returns null on malformed input. */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) return null;
  const [, did, collection, rkey] = match;
  if (!did || !collection || !rkey) return null;
  return { did, collection, rkey };
}

/** Stable content-addressed hash of a blob (sha256 hex). */
export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Random opaque token, hex-encoded. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
