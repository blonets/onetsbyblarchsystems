#!/bin/sh
# api-entrypoint.sh — runs Prisma migrations, then starts the API server.
#
# Runs as the container ENTRYPOINT (see infra/docker/Dockerfile.api).
# Requires DATABASE_URL in the environment. The prisma CLI (pinned version)
# and the schema/migrations are baked into the image at build time.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "api-entrypoint: WARNING: DATABASE_URL is not set — skipping migrations" >&2
else
  echo "api-entrypoint: running prisma migrate deploy..."
  ./node_modules/.bin/prisma migrate deploy --schema ./prisma/schema.prisma
  echo "api-entrypoint: migrations complete"
fi

exec "$@"
