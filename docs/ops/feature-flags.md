# Feature flags

Flags are read by `apps/api/src/services/flags.ts`. Resolution order:

1. **Env override** `OPENXIV_FLAG_<KEY>=1|0|on|off` — instant, no restart.
2. **Redis hash** `openxiv:flags` — runtime via admin endpoints; cached
   for 30s in each API process.
3. **Code default** — the second argument to `isEnabled(key, default)`.

## Profile system (Phase 7, rolled out 2026-05-18)

| Key | Default | TTL | Owner | Purpose |
|---|---|---|---|---|
| `profile_use_canonical_did` | on | permanent | platform | gate the canonicalDidForProfile pipeline; off → users get pre-Phase-5 placeholder behaviour |
| `profile_did_web_resolution_enabled` | on | permanent | platform | serve `/u/:subject/did.json` with verificationMethod |
| `profile_legacy_local_fallback_enabled` | on (off after 2026-06-17) | 30d | platform | accept `did:web:openxiv.local:*` lookups; flips off 30d after deploy |
| `profile_bluesky_did_plc_enabled` | on | permanent | platform | resolve Bluesky users to their native `did:plc:*`; off → fallback to did:web shadow |
| `profile_secp256k1_keys_enabled` | on | permanent | platform | publish secp256k1 keys in user DID Doc; off → DID Doc without verificationMethod (emergency only) |
| `profile_reserved_handles_enforced` | on | permanent | platform | block reserved-handle list at sign-up |
| `profile_impersonation_check_enabled` | on | permanent | platform | run impersonation gate on /me/handle |
| `account_linking_enabled` | on | permanent | platform | gate /me/links endpoints |
| `legacy_unprefixed_mount_enabled` | on (off after smoke) | 14d | platform | keep `/profiles/*` etc reachable without `/api` prefix; flip after every caller has moved |

### How to flip a flag

```bash
# Env override (preferred for emergencies):
ssh root@173.212.216.82 'echo "OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT=0" >> /opt/openxiv/.env'
ssh root@173.212.216.82 'cd /opt/openxiv && docker compose up -d api'

# Runtime via Redis (preferred for non-emergency, persists across restarts):
ssh root@173.212.216.82 'docker exec openxiv-redis-1 redis-cli HSET openxiv:flags legacy_unprefixed_mount_enabled 0'
# 30s later every API process picks up the change without a restart.
```

### Sunset policy

When a flag's TTL elapses, drop the flag entry from `flags.ts` and
delete its Redis key. Keeping stale flags around degrades code
readability for no benefit.

## Bluesky / Phase 5 (rolled out 2026-05-15)

Documented in `docs/BLUESKY-GO-LIVE.md`.

## Phase 6 — external integrations (rolled out 2026-05-17)

Documented in the relevant sub-system READMEs (`ROR`, `OpenAlex`,
`CFF`, etc.).
