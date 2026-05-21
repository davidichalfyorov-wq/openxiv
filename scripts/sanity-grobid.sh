#!/usr/bin/env bash
# Continuous GROBID liveness probe. Designed to run from cron on the VPS
# every minute (or from a systemd timer). Emits a single line to stdout
# describing the state and exits non-zero on failure so cron mail picks
# it up.
#
# Goes through three layers:
#   1. docker inspect → container health status
#   2. /api/isalive    → API readiness (response body must equal "true")
#   3. /api/version    → optional, fails-soft if missing
#
# Usage (on the prod VPS):
#   bash /opt/openxiv/scripts/sanity-grobid.sh             # one-shot
#   while sleep 60; do bash /opt/openxiv/scripts/sanity-grobid.sh; done

set -u

CONTAINER="${GROBID_CONTAINER:-openxiv-grobid-1}"
NETWORK_URL="${GROBID_URL:-http://grobid:8070}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HEALTH=$(docker inspect "$CONTAINER" --format "{{.State.Health.Status}}" 2>/dev/null || echo "missing")
RESTARTS=$(docker inspect "$CONTAINER" --format "{{.RestartCount}}" 2>/dev/null || echo "?")

# The container itself uses bash + /dev/tcp because the image has no
# curl. We invoke the same probe from outside via `docker exec`.
ISALIVE=$(docker exec "$CONTAINER" bash -c \
  'exec 3<>/dev/tcp/localhost/8070; \
   printf "GET /api/isalive HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3; \
   head -c 4096 <&3' 2>/dev/null | tr -d "\r" | tail -1 || echo "")

if [ "$ISALIVE" = "true" ]; then
  echo "$TS grobid=ok container=$HEALTH restarts=$RESTARTS"
  exit 0
fi

echo "$TS grobid=DOWN container=$HEALTH restarts=$RESTARTS isalive='$ISALIVE'"
exit 1
