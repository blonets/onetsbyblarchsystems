#!/bin/sh
# api-entrypoint.sh — runs Prisma migrations, then starts the API server.
#
# Runs as the container ENTRYPOINT (see infra/docker/Dockerfile.api).
# Requires DATABASE_URL in the environment. The prisma CLI (pinned version,
# installed in isolation at /opt/prisma-cli) and the schema/migrations are
# baked into the image at build time.
#
# One-shot recovery: if a previous deploy left a migration recorded as
# FAILED, every `migrate deploy` is refused (Prisma P3009) and the API can
# never boot. Arming PRISMA_RESOLVE_ROLLED_BACK=<migration name> for a single
# deploy makes the entrypoint mark that migration as rolled back (its changes
# never committed — migration files run in one transaction) and retry the
# deploy once. The variable is inert when the deploy succeeds, and must be
# removed from the environment after the recovery deploy.
set -eu

PRISMA=/opt/prisma-cli/node_modules/.bin/prisma
SCHEMA=./prisma/schema.prisma

run_migrations() {
  echo "api-entrypoint: running prisma migrate deploy..."
  if "$PRISMA" migrate deploy --schema "$SCHEMA"; then
    echo "api-entrypoint: migrations complete"
    return 0
  fi
  if [ -n "${PRISMA_RESOLVE_ROLLED_BACK:-}" ]; then
    echo "api-entrypoint: deploy refused/failed — resolving ${PRISMA_RESOLVE_ROLLED_BACK} as rolled back (one-shot recovery)..."
    "$PRISMA" migrate resolve --rolled-back "${PRISMA_RESOLVE_ROLLED_BACK}" --schema "$SCHEMA"
    echo "api-entrypoint: retrying prisma migrate deploy..."
    "$PRISMA" migrate deploy --schema "$SCHEMA"
    echo "api-entrypoint: migrations complete (after resolve)"
    return 0
  fi
  echo "api-entrypoint: ERROR: prisma migrate deploy failed" >&2
  return 1
}

if [ -z "${DATABASE_URL:-}" ]; then
  echo "api-entrypoint: WARNING: DATABASE_URL is not set — skipping migrations" >&2
else
  run_migrations
fi

exec "$@"
