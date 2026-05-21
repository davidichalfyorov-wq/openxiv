# Analytics

Self-hosted Umami collects pageview counts from openxiv.net. Privacy
properties: no cookies, no IP address stored, no cross-site tracking.
The dashboard is gated behind a username and password set by the
operator.

## DNS

Add one A record before the first deploy:

```
analytics.openxiv.net  A  173.212.216.82
```

The record points at the same Contabo VPS that serves openxiv.net.
Caddy on the VPS terminates HTTPS for both names and routes the
analytics subdomain to the umami container.

## Environment variables

Set these in `/opt/openxiv/.env` on the VPS before the first deploy:

```
UMAMI_APP_SECRET=<openssl rand -hex 32>
UMAMI_DATABASE_URL=postgres://openxiv:openxiv@postgres:5432/umami
PUBLIC_UMAMI_SCRIPT_URL=https://analytics.openxiv.net/script.js
PUBLIC_UMAMI_WEBSITE_ID=<UUID issued by the Umami dashboard>
```

`UMAMI_APP_SECRET` signs the session token. Keep it secret.
`PUBLIC_UMAMI_WEBSITE_ID` does not appear in the dashboard until after
the first login (see provisioning below). Leave it empty in the env on
the first deploy, run the provisioning steps, then set it and restart
the web service.

## First-time provisioning

1. Deploy with the umami containers running and
   `PUBLIC_UMAMI_SCRIPT_URL` and `PUBLIC_UMAMI_WEBSITE_ID` empty:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
   ```

   The `umami-init` container creates the `umami` Postgres database if
   it does not exist. The `umami` container runs its own schema
   migrations on first start.

2. Open <https://analytics.openxiv.net> in a browser. Default admin
   credentials are `admin` and `umami`. Change the password immediately
   under **Settings → Profile**.

3. Add the website. **Settings → Websites → Add website**. Name
   `openxiv.net`, domain `openxiv.net`. Save.

4. Copy the **Website ID** (UUID) from the new entry.

5. Put it into `/opt/openxiv/.env` as `PUBLIC_UMAMI_WEBSITE_ID`, set
   `PUBLIC_UMAMI_SCRIPT_URL=https://analytics.openxiv.net/script.js`,
   and restart the web service:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.production.yml up -d web
   ```

6. Verify a pageview reaches the dashboard within one minute of
   loading a page on openxiv.net with the analytics consent cookie set.

## Consent gate

The tracker only loads when the visitor has granted analytics consent
through the cookie banner. Visitors who reject or who set Do Not Track
get no script and no network call to analytics.openxiv.net.

This is enforced both at SSR time (the script tag is omitted from the
HTML) and again on the client by the umami consent integration. The
SSR gate is the load-bearing one. The component lives in
`apps/web/src/components/UmamiTracker.astro`.

## Disabling

Set `PUBLIC_UMAMI_SCRIPT_URL=` (empty) in the env and restart the web
service. The layout will skip the script tag on every page. The
umami container can keep running, the dashboard at
analytics.openxiv.net stays available for historical data.

## Rotation

To rotate `UMAMI_APP_SECRET`, update the value in `/opt/openxiv/.env`
and restart the umami service:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d umami
```

Active sessions are invalidated and operators must sign in again.

## Backups

The Umami database is part of the openxiv Postgres instance. The
existing nightly `pg_dumpall` already covers it. No additional backup
work is needed.

## Removal

If Umami is decommissioned:

1. Set `PUBLIC_UMAMI_SCRIPT_URL=` empty and restart web.
2. Run `docker compose stop umami umami-init` then `docker compose rm
   umami umami-init`.
3. Drop the database when finished: `docker compose exec postgres
   psql -U openxiv -c 'DROP DATABASE umami;'`.
4. Remove the `analytics.openxiv.net` block from
   `Caddyfile.production` and reload Caddy.
5. Delete the DNS A record for `analytics.openxiv.net`.
