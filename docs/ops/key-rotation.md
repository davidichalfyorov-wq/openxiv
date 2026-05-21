# KEK rotation runbook

The `OPENXIV_KEK_BASE64` master key encrypts every user's signing
private key. Rotating it requires re-encrypting every row's
`encrypted_signing_key` column under the new KEK without leaving the
table in an inconsistent state.

## When to rotate

- **Routine:** every 12 months.
- **Compromise:** immediately, plus rotate every per-user keypair (see
  "Compromise procedure" below).
- **Operator turnover:** before the previous operator loses VPS access.

## Procedure (zero-downtime)

The rotation runs against the live API. It uses a **two-key
transitional period**:

1. Generate the new KEK and add it to `/opt/openxiv/.env` as
   `OPENXIV_KEK_NEXT_BASE64`. Keep the current `OPENXIV_KEK_BASE64`
   value in place.

2. Deploy the API with both env vars set. The API will accept either
   KEK for decryption (tried in `OPENXIV_KEK_BASE64` first, then
   `OPENXIV_KEK_NEXT_BASE64`), and will encrypt new rows under
   `OPENXIV_KEK_BASE64` still.

   > NOTE: the two-key code path is not yet implemented. Today the
   > rotation requires a brief read-only window. Bumping the API in
   > Phase 8 follow-up will add it.

3. Run `node /app/apps/api/dist/scripts/rotate-kek.js`. Per-row, in
   batches of 100, this script decrypts under the current KEK and
   re-encrypts under the next KEK, writing both ciphertexts in a
   single transaction. Failures are recorded in `_kek_rotation_audit`.

4. Once the audit shows 100% re-encryption, swap the env vars: set
   `OPENXIV_KEK_BASE64` to the new value and remove
   `OPENXIV_KEK_NEXT_BASE64`. Restart the API.

5. Securely destroy the previous KEK (paper shred + delete from any
   backup location it was staged in).

## Compromise procedure

If the KEK is believed compromised, rotation alone is not sufficient
because the attacker may already hold decrypted private keys. After
the KEK rotation:

- For every user with `did:web:openxiv.net:u:*`, run
  `POST /api/me/did/rotate-key` (or the bulk operator endpoint
  `node /app/apps/api/dist/scripts/rotate-all-user-keys.js
  --reason=compromise`).
- This generates a fresh secp256k1 keypair per user and archives the
  prior pubkey into `users.retired_pubkeys` so signatures already in
  the wild keep verifying against the published DID Document.
- Announce the rotation in the public security log; external
  resolvers cache DID docs and will pick up the new key on their
  natural refresh.

## Pre-flight checklist

- [ ] New KEK generated on an offline machine.
- [ ] Backed up `/opt/openxiv/postgres/data` (volume snapshot) within
      the last hour.
- [ ] Maintenance window announced if the two-key code path is not
      yet shipped.
- [ ] `OPENXIV_KEK_BASE64` value confirmed correct against a known
      ciphertext before swapping (decrypt one row as a probe).

## Rollback

If the rotation script fails partway:

1. Stop further iteration (`kill <pid>`).
2. Inspect `_kek_rotation_audit` — every row recorded there is
   confirmed re-encrypted; everything not listed is still under the
   old KEK.
3. Re-run the script. It's idempotent (skips rows already in the
   audit).
4. If a row's decrypt fails (e.g. corruption), set its
   `encrypted_signing_key` and `signing_key_nonce` to NULL and
   trigger a fresh keypair via the user's next sign-in (idempotent
   `ensureKeypair` path).

## Audit

After every rotation, append a line to `docs/ops/key-rotation.log`:

```
2026-05-18  david   routine    250 rows  ok=250 fail=0
```
