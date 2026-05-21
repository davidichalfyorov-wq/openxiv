/**
 * Pure helpers for hashing PII (today: emails) before sending it to
 * third-party trackers. SHA-256 + hex output is the format Twitter Ads
 * expects in the `email_address` parameter of conversion events.
 *
 * `crypto.subtle.digest` is available in every modern browser and in
 * Node 19+ via `globalThis.crypto`. We don't ship a wasm/polyfill
 * fallback — older runtimes simply skip hashing (the caller doesn't pass
 * the parameter, and Twitter's match rate degrades for that visitor).
 */

/**
 * `email` is lower-cased and trimmed before hashing — Twitter's match
 * pipeline normalises the same way, so we converge to identical digests.
 *
 * Returns a 64-character hex string. Throws if `crypto.subtle` is
 * absent OR `email` is empty after normalisation.
 */
export async function sha256Hex(email: string): Promise<string> {
  if (typeof email !== 'string') throw new Error('sha256Hex: email must be a string');
  const normalised = email.trim().toLowerCase();
  if (normalised.length === 0) throw new Error('sha256Hex: empty input after trim');
  const subtle: SubtleCrypto | undefined =
    typeof globalThis !== 'undefined' && globalThis.crypto?.subtle ? globalThis.crypto.subtle : undefined;
  if (!subtle) throw new Error('sha256Hex: crypto.subtle unavailable');
  const buf = new TextEncoder().encode(normalised);
  const digest = await subtle.digest('SHA-256', buf);
  return bufferToHex(new Uint8Array(digest));
}

function bufferToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}
