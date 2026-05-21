# Operator secrets

This document lists the secrets the OpenXiv API container reads from
the environment, where they're stored, and what happens when each one
is rotated or missing.

## `OPENXIV_KEK_BASE64`

**Purpose:** 32-byte symmetric key used to encrypt every user's
signing private key on disk (via XChaCha20-Poly1305).

**Format:** base64-encoded 32 raw bytes. Generate with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Storage:** in `/opt/openxiv/.env` on the VPS, loaded via the
`env_file` directive in `docker-compose.production.yml`. Never commit
the value to git. Treat it like a database master key — anyone with
the KEK can decrypt every user's private key.

**Failure mode if missing:** the API still serves *read* traffic; the
only paths that fail are `/api/me/did/rotate-key` (returns 503) and
the keypair-bootstrap step in `upsertFromOAuth` (silently no-ops, the
user's DID document publishes without a verificationMethod until KEK
is restored).

**Rotation:** see `docs/ops/key-rotation.md`.

## `OPENXIV_SERVICE_PRIVATE_KEY_BASE64` / `OPENXIV_SERVICE_PRIVATE_KEY_HEX`

**Purpose:** secp256k1 private key used by the App View to sign Trust
Passport JSON-LD artifacts at `/api/papers/:id/passport` and
`/abs/:id/passport.json`.

**Format:** one of:

- `OPENXIV_SERVICE_PRIVATE_KEY_BASE64`: base64-encoded 32-byte
  secp256k1 private key.
- `OPENXIV_SERVICE_PRIVATE_KEY_HEX`: 64 hex chars for the same 32 raw
  bytes.

Generate with the same `@noble/secp256k1` helper used by the app, then
store only the private value in the VPS environment. In local dev, if
neither value is present, the API derives a deterministic fallback key
from `JWT_SECRET` so the Passport route remains signed and testable.
Production should use an explicit service key.

**Failure mode if missing:** local/dev still signs from the fallback
key. Production should be treated as misconfigured unless an explicit
service key is present.

## `OPENXIV_SERVICE_PUBLIC_MULTIBASE` (optional override)

**Purpose:** public half of the App View signing key published in
`/.well-known/did.json`. If omitted, the API derives it from the
configured private key. Set this only when the public value is managed
separately by ops.

**Format:** multibase Multikey, e.g. `z6Mk…`.

**Failure mode if missing:** none when a private service key is
configured; the DID document derives and publishes the public key.

## OAuth client credentials

Stored as plain env vars in `/opt/openxiv/.env`:

- `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `BLUESKY_OAUTH_CLIENT_ID` (URL of client-metadata.json — public)

Re-issue via each provider's dev console; redirect URIs MUST point at
`https://openxiv.net/auth/{provider}/callback` (note: not under
`/api/` — these endpoints are pinned by external IdPs).

## `SESSION_SECRET`

**Purpose:** HS256 HMAC for signing the JWT in the session cookie.

**Format:** at least 32 random bytes.

**Failure mode if rotated:** every existing session is invalidated;
all users are signed out. Schedule rotations during low-traffic
windows.

## Feature flags (env override)

Any flag in `apps/api/src/services/flags.ts` can be force-overridden
with `OPENXIV_FLAG_<KEY>=1|0`. The env override wins over Redis. The
profile-system flags are documented in `docs/ops/feature-flags.md`.
