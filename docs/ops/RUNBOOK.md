# OpenXiv Operations Runbook

Production host path: `/opt/openxiv`.

Compose stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
```

## Restart Service

Use this when the code and env are already present on the VPS.

```bash
cd /opt/openxiv
docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d api worker web caddy
docker compose -f docker-compose.yml -f docker-compose.production.yml ps api worker web caddy
curl -fsS https://openxiv.net/healthz
```

For a full rebuild after code changes:

```bash
cd /opt/openxiv
pnpm install --frozen-lockfile
pnpm -r build
docker compose -f docker-compose.yml -f docker-compose.production.yml build api worker web
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d api worker web caddy
docker compose -f docker-compose.yml -f docker-compose.production.yml ps api worker web caddy
curl -fsS https://openxiv.net/healthz
```

After restart, run the production Playwright gate from a trusted workstation:

```powershell
$env:E2E_BASE_URL = "https://openxiv.net"
pnpm --filter @openxiv/e2e test -- tests/production-copy.spec.ts tests/profile-seo.spec.ts tests/scholar-metadata.spec.ts
```

Authenticated flows require dedicated live-test identities and cleanup access.

## Rotate Secrets

Treat any secret copied into a workspace as compromised. Rotate at the provider,
then update `/opt/openxiv/.env` on the VPS.

High-risk keys:

- `SESSION_SECRET`, JWT/session signing material.
- `USER_KEY_KEK`, encrypted user signing-key KEK.
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- ORCID, Google, Bluesky, Gemini, DeepSeek provider credentials.
- SSH private keys used for VPS access.

Rotation procedure:

```bash
cd /opt/openxiv
cp .env ".env.backup.$(date -u +%Y%m%dT%H%M%SZ)"
chmod 600 .env ".env.backup."*
editor .env
docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d api worker web caddy
curl -fsS https://openxiv.net/healthz
```

If rotating `USER_KEY_KEK`, follow `docs/ops/key-rotation.md`; do not simply
replace it unless all encrypted user keys have been rewrapped.

## Restore Backup

Before restore, stop writers:

```bash
cd /opt/openxiv
docker compose -f docker-compose.yml -f docker-compose.production.yml stop api worker web
```

Restore Postgres from a plain SQL dump:

```bash
cat /opt/openxiv/backups/openxiv.sql |
  docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres \
  psql -U openxiv -d openxiv -v ON_ERROR_STOP=1
```

Restore MinIO/S3 objects from a backup directory or provider snapshot before
starting workers. Paper rows and object keys must match.

Start services and verify:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d api worker web caddy
curl -fsS https://openxiv.net/healthz
docker compose -f docker-compose.yml -f docker-compose.production.yml logs --tail=100 api worker
```

If queues contain jobs from before the restore point, inspect BullMQ queue
depths via `/admin/health` before allowing new submissions.
