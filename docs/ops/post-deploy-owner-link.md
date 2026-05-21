# Owner post-deploy Bluesky link

This document is the operator-facing procedure to bind the owner's
Bluesky `did:plc:dzhzljg4peg765tpd2q63luc` to the existing ORCID
account. It is the manual step referenced in the Phase 7 deploy
runbook.

## Pre-condition

After the Phase 7 deploy:
- The reserved_dids table contains a row for
  `did:plc:dzhzljg4peg765tpd2q63luc` with `reserved_for_user_id`
  pointing at the owner's user row. This blocks anyone else from
  claiming the DID before the link.
- The owner's user row has `did = did:web:openxiv.net:u:orcid.0009-0003-6027-7837`
  and `handle = david-alfyorov` (the migration auto-chose this from
  the display name; the owner can rename to `ddavidich` from
  `/auth/welcome` after the link).

## Procedure (one-shot, takes ~30 seconds)

```bash
ssh root@173.212.216.82
docker exec openxiv-api-1 node /app/apps/api/dist/scripts/admin-link-bluesky.js \
  --user-id=1c9f5f1a-ca59-4e87-8413-ad12754d3be2 \
  --did=did:plc:dzhzljg4peg765tpd2q63luc \
  --handle=ddavidich
```

Expected output:

```
linked OK; user.did is now did:plc:dzhzljg4peg765tpd2q63luc
legacy_dids: did:web:openxiv.local:orcid.0009-0003-6027-7837, did:web:openxiv.net:u:orcid.0009-0003-6027-7837
```

## Verify

```bash
# Canonical (new primary): 200
curl -sI https://openxiv.net/api/profiles/did:plc:dzhzljg4peg765tpd2q63luc

# Handle still works: 200
curl -sI https://openxiv.net/api/profiles/david-alfyorov

# Legacy did:web canonical: 301 to /api/profiles/david-alfyorov
curl -sI https://openxiv.net/api/profiles/did:web:openxiv.net:u:orcid.0009-0003-6027-7837

# Legacy openxiv.local: 301 to /api/profiles/david-alfyorov
curl -sI https://openxiv.net/api/profiles/did:web:openxiv.local:orcid.0009-0003-6027-7837

# /u/{subject}/did.json now 301s to plc.directory (the authoritative source):
curl -sI https://openxiv.net/u/orcid.0009-0003-6027-7837/did.json
```

## Rename handle to `ddavidich`

After linking, the owner can rename via the API:

```bash
# Get a session cookie via ORCID sign-in, then:
curl -X POST https://openxiv.net/api/me/handle \
  -H 'content-type: application/json' \
  -H 'cookie: openxiv_session=<token>' \
  -d '{"handle":"ddavidich"}'
```

The reserved-handles policy already lists `ddavidich` as reserved
**for the owner**, so no impersonation gate blocks the rename.
(Future improvement: bind reserved handles to a specific user_id so
the policy is enforced by the API rather than by social trust.)
