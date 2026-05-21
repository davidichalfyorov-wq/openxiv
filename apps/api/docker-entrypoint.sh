#!/bin/sh
set -e

ROLE="${1:-api}"

if [ "${OPENXIV_RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] running migrations..."
  node --enable-source-maps packages/db/dist/migrate.js
fi

case "$ROLE" in
  api)
    echo "[entrypoint] starting api"
    exec node --enable-source-maps apps/api/dist/index.js
    ;;
  worker)
    echo "[entrypoint] starting worker"
    exec node --enable-source-maps apps/api/dist/worker.js
    ;;
  *)
    echo "[entrypoint] unknown role: $ROLE" >&2
    exit 1
    ;;
esac
