# MikroTik Fleet Platform — "CafeAndResturantsSystems"

Full-TypeScript control panel for managing **1000+ MikroTik routers** (RouterOS v5/v6/v7)
deployed in cafes, restaurants and hotels. Each site router acts as firewall + hotspot for
resold internet; the platform provisions, monitors, backs up and configures the whole fleet
from one dashboard.

## Architecture (locked)

**Hub-and-spoke over SSTP**

- One MikroTik CHR is the **SSTP server** (TCP 443). Every site router is an SSTP
  **client** dialing out — no inbound ports needed at the sites.
- Tunnel supernet `10.200.0.0/16`. Each router gets a **unique SSTP username/password**
  and a **static tunnel IP** via `/ppp secret` `remote-address`.
- Every router carries a platform **UUID**, stamped into `/system identity` comment.
- The hub is addressed via DNS (`SSTP_HUB_HOST`), never a hardcoded IP.
- Management traffic runs over the **RouterOS API** inside the tunnel.

**Monorepo**

| Path | What |
|---|---|
| `packages/ros-api` | Zero-heavy-dep TypeScript RouterOS API client: binary word protocol, both login flows (pre-6.43 MD5 challenge-response and 6.43+/v7 direct), typed command builders (hotspot, firewall, queue, system, ppp). Transport is injectable — unit tests run against an in-process fake, no network. |
| `packages/types` | Shared DTOs (`RouterStatus`, `HotspotUser`, `FirewallRule`, `QueueItem`, `BackupRecord`, `AuditEvent`, `ProvisioningToken`, `DownstreamDevice`, …). |
| `apps/api` | NestJS backend. Modules: `auth` (JWT guard + roles), `health`, `routers` (CRUD + status), `provisioning` (real: credential generation, tunnel-IP allocation, onboarding tokens, hub `/ppp secret` provisioning). BullMQ + Redis, PostgreSQL + TimescaleDB via Prisma. |
| `apps/worker` | BullMQ workers: `ConnectionManager` (persistent ros-api sessions, reconnect with backoff, downtime ledger), pollers sharded by router-id hash, backup jobs. |
| `apps/web` | Next.js App Router (TS), Tailwind + shadcn-style UI, `next-intl` with **ar (RTL default)** + en, React Query. Dashboard shell + routers list. |
| `infra/docker` | Multi-stage Dockerfiles for api / worker / web. |
| `infra/dokploy/compose.yml` | Dokploy stack: postgres+TimescaleDB, redis, api, worker, web. All env-driven, no secrets committed. |
| `infra/ros-scripts` | Placeholder — the `.rsc` device scripts (`sstp-hub-setup`, `sstp-client-template`, `onboard`, `watchdog`) are authored by the protocol agent and land in a follow-up commit. |

**Downstream devices** behind a site router are reached through platform-managed dynamic
dst-nat rules (`comment=panel-proxy:<deviceId>`); downstream MikroTiks register as managed
routers (cascade).

## Local quickstart

```bash
cp .env.example .env   # fill in real values locally — never commit .env
pnpm install
pnpm typecheck
pnpm test
pnpm build

# run everything (api :3001, worker, web :3000)
pnpm dev
```

Per-app:

```bash
pnpm --filter @mtk/ros-api test     # hermetic protocol tests, no network
pnpm --filter @mtk/api dev          # NestJS, http://localhost:3001/health
pnpm --filter @mtk/worker dev       # BullMQ workers (needs Redis)
pnpm --filter @mtk/web dev          # Next.js, http://localhost:3000
```

## Configuration

Everything is env-driven — see `.env.example`. Key variables:

- `SSTP_HUB_HOST` / `SSTP_HUB_API_PORT` / `SSTP_HUB_API_USER` / `SSTP_HUB_API_PASSWORD`
- `TUNNEL_SUPERNET=10.200.0.0/16`, `TUNNEL_HUB_IP=10.200.0.1`
- `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL`
- `WORKER_SHARD_INDEX` / `WORKER_SHARD_COUNT` for poller sharding

## Security notes

- **No secrets in this repo.** Only `.env.example` with placeholders is tracked.
- SSTP passwords and the API JWT secret are passed via environment at runtime only.
- Router SSTP passwords are stored as vault references (`sstpPasswordRef`) — never plaintext.
- Prisma schema ships; DB-touching code paths are marked `TODO` until the client is wired.

## Conventions

- TypeScript everywhere, strict mode.
- Conventional commits (`feat:`, `fix:`, `chore:` …).
- Stubs carry `TODO` with the intended interface — never dead code without a pointer.
