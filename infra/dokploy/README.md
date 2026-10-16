# Dokploy Deployment — MikroTik Fleet Platform

Production deployment reference for the `mtk-fleet` stack on Dokploy.
All configuration is env-driven; see [`.env.example`](./.env.example) for the
full variable reference. No secrets live in code, Dockerfiles, or this repo.

## Architecture

One Dokploy **Project** → one **Environment** (`production`) → one of:

| Approach | Services | When to use |
|---|---|---|
| **Compose** (`infra/dokploy/compose.yml`) | postgres, redis, api, worker, web in one unit | Recommended: single cohesive stack, one deploy pipeline |
| **Applications** (one per service) | `mtk-api`, `mtk-worker`, `mtk-web` + managed DBs | When you need independent scaling/logs/domains per service |

Both pull from the same GitHub repo (`blonets/onetsbyblarchsystems`, branch
`main`); each app build uses its own Dockerfile under `infra/docker/`.

> **GitHub App access (prerequisite).** The Dokploy GitHub App must be granted
> access to the `onetsbyblarchsystems` repository, otherwise clones fail fast
> and deployments error within seconds. GitHub → Settings → Applications →
> Dokploy → Repository access → add the repo.

## First-time setup (Compose path)

1. **Create the project** in Dokploy (e.g. `CafeAndResturantsSystems`),
   environment `production`.
2. **Create a Compose** service:
   - Source: GitHub, repo `blonets/onetsbyblarchsystems`, branch `main`
   - Compose path: `infra/dokploy/compose.yml`
3. **Set environment variables**: copy [`.env.example`](./.env.example),
   fill every `REQUIRED` value (generate strong secrets), and paste into the
   Compose's Environment tab in Dokploy.
4. **Deploy.** The API entrypoint runs `prisma migrate deploy` automatically
   on first start (includes the TimescaleDB extension + hypertables).
5. **Domains** (Dokploy → each app/service → Domains):
   - Web dashboard → e.g. `admin.example.com`
   - API → e.g. `api.example.com` (only if browsers/clients need it directly)
   - Keep `NEXT_PUBLIC_API_URL`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL`,
     `CORS_ORIGIN` in sync with these.
6. **Verify**: `https://<api-domain>/health` → `{"status":"ok",...}`.

## Update flow (zero-downtime)

```
git push to main
  → CI (typecheck / test / build) must stay green
  → Dokploy auto-deploy (webhook) builds new images
  → DB migrations run in the API entrypoint BEFORE the new server starts
  → healthcheck (/health) gates traffic; unhealthy containers never go live
  → old containers stop only after replacements are healthy
```

Rules that keep updates safe:

- **Migrations must be backward-compatible** with the previous release
  (additive changes first; destructive changes in a later release).
- `NEXT_PUBLIC_*` vars are baked into the web bundle at **build** time —
  changing `NEXT_PUBLIC_API_URL` requires a rebuild, not just a restart.
- Never change `DATABASE_URL` credentials without updating both the postgres
  service and the API/worker env together.

## Environment variable reference

Grouped summary — full docs in [`.env.example`](./.env.example):

| Group | Variables |
|---|---|
| Database | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL` |
| Redis | `REDIS_URL` |
| API | `API_PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL` |
| Hub | `SSTP_HUB_HOST`, `SSTP_HUB_API_PORT`, `SSTP_HUB_API_USER`, `SSTP_HUB_API_PASSWORD` |
| Tunnel | `TUNNEL_SUPERNET`, `TUNNEL_HUB_IP` |
| Web | `NEXT_PUBLIC_API_URL` (+ `PUBLIC_WEB_URL` for email links) |
| Worker | `WORKER_SHARD_INDEX`, `WORKER_SHARD_COUNT`, `POLL_INTERVAL_MS` |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Domains | `DOMAIN_WEB`, `DOMAIN_API` (reference; bound in Dokploy UI) |

## Scaling

- **Worker**: raise replicas; give each a unique `WORKER_SHARD_INDEX` in
  `[0, WORKER_SHARD_COUNT)` so shards don't overlap.
- **API / Web**: stateless — scale replicas freely behind Dokploy's proxy.
  (WebSocket clients should use sticky sessions if you run >1 API replica.)
- **Postgres / Redis**: single-replica with persistent volumes (`pgdata`,
  `redisdata`). Scale reads via replicas only with an external HA design.

## Backups

- **Postgres**: volume `pgdata` holds all data. Take scheduled logical backups
  (`pg_dump`) in addition to volume snapshots; test restores.
- **Redis**: AOF persistence (`--appendonly yes`) on volume `redisdata`.
  Queues are ephemeral by design; no backup needed beyond the volume.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy errors in ~2–5s | GitHub App lacks repo access, or wrong compose/Dockerfile path | Grant repo access; verify `infra/dokploy/compose.yml` / `infra/docker/Dockerfile.*` |
| API container restarts, `/health` never OK | `DATABASE_URL` wrong or postgres unhealthy | Check postgres logs; verify credentials match on both sides |
| `prisma migrate deploy` fails at start | DB user lacks `CREATEDB`/extension rights | The compose `POSTGRES_USER` is the DB owner — use it in `DATABASE_URL` |
| Web shows API connection errors | `NEXT_PUBLIC_API_URL` mismatch | Must equal the public API domain; **rebuild** web after changing |
| Tunnel/API calls to hub fail | `SSTP_HUB_*` wrong | Verify host, port, user; hub API must be reachable from the VPS |
| Emails never send | SMTP vars empty/misconfigured | Fill `SMTP_*`; empty `SMTP_HOST` disables email silently by design |
| `curl: not found` in api healthcheck | Image rebuilt from an old Dockerfile | Ensure `infra/docker/Dockerfile.api` includes the curl install layer |

## Local development

```bash
cp infra/dokploy/.env.example .env   # fill dev values (defaults work)
docker compose -f infra/docker/compose.dev.yml --env-file .env up --build
```

Hot reload: API/worker via `tsx watch`, web via `next dev`. Source is
bind-mounted; `node_modules` stay in named volumes.
