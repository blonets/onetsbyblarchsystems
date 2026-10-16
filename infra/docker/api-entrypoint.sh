#!/bin/sh
# api-entrypoint.sh — runs Prisma migrations, then starts the API server.
#
# Runs as the container ENTRYPOINT (see infra/docker/Dockerfile.api).
# Requires DATABASE_URL in the environment. The prisma CLI (pinned version,
# installed in isolation at /opt/prisma-cli) and the schema/migrations are
# baked into the image at build time.
set -eu

PRISMA=/opt/prisma-cli/node_modules/.bin/prisma

if [ -z "${DATABASE_URL:-}" ]; then
  echo "api-entrypoint: WARNING: DATABASE_URL is not set — skipping migrations" >&2
else
  echo "api-entrypoint: running prisma migrate deploy..."
  "$PRISMA" migrate deploy --schema ./prisma/schema.prisma
  echo "api-entrypoint: migrations complete"
fi

exec "$@"
