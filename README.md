# MikroTik Fleet Platform — Enterprise Control Panel

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![Node](https://img.shields.io/badge/Node.js-22.x-green.svg)
![Status](https://img.shields.io/badge/Status-Phase%200%20%26%201%20Verified%20Live-brightgreen.svg)
![Dokploy](https://img.shields.io/badge/Deployment-Dokploy%20Docker%20Compose-purple.svg)

Full-TypeScript enterprise control panel for orchestrating, monitoring, and managing **1000+ MikroTik routers** (RouterOS v6 & v7) deployed across multi-tenant cafes, restaurants, hotels, and branches.

Each site router acts as a managed firewall + hotspot gateway for resold guest internet. The platform provisions VPN tunnels, continuously ingests real-time telemetry into TimescaleDB, applies atomic configuration changes with rollback safety, schedules encrypted backups, and controls hotspot vouchers and user quotas from a unified bilingual dashboard (**Arabic RTL default** & English).

---

## 🌐 Production Environment & Architecture

The production platform is hosted on a high-performance VPS orchestrated via **Dokploy Docker Compose**:

| Domain / Host | Role | Technology / Port |
|---|---|---|
| `admin.onetsbyblarch.online` | Web Control Panel (RTL/LTR) | Next.js 15 App Router (`web:3000`) via Traefik |
| `api.onetsbyblarch.online` | Core Platform REST & Event API | NestJS 11 (`api:3001`) via Traefik |
| `vpn.onetsbyblarch.online` | SSTP VPN Server Hub (CHR) | RouterOS CHR 6.49.17 (`TCP 443`) |

```
                              +-------------------------------------------------+
                              |          DOKPLOY DOCKER COMPOSE STACK           |
                              |  • Web: Next.js (Arabic RTL + English LTR)      |
                              |  • API: NestJS REST + BullMQ Producers          |
                              |  • Worker: BullMQ Consumers + Health Monitor    |
                              |  • Postgres: PostgreSQL 16 + TimescaleDB        |
                              |  • Cache/Queue: Redis 7-alpine                  |
                              +------------------------+------------------------+
                                                       |
                             Internal Key / Tunnel     | Management Traffic
                                                       v
+======================================================================================================+
|  MIKROTIK CHR VPN HUB (`vpn.onetsbyblarch.online` - 34.91.70.17:443)                                |
|  • SSTP Server on TCP 443 with Let's Encrypt TLS (Gen-Y Chain: YR2 -> Root YR)                       |
|  • Supernet: 10.200.0.0/16 (Hub Server IP: 10.200.0.1)                                               |
|  • Dynamic PPP Secret Provisioning with Vault-encrypted credentials                                 |
+==================================================+===================================================+
                                                   |
                     Dialed OUT from site routers (TCP 443 - Bypasses NAT & Firewalls)
                                                   |
               +-----------------------------------+-----------------------------------+
               |                                                                       |
               v                                                                       v
+-----------------------------+                                         +-----------------------------+
| Site Router #1 (Branch A)   |                                         | Site Router #2 (Branch B)   |
| • RouterOS v6 / v7          |                                         | • RouterOS v6 / v7          |
| • Tunnel IP: 10.200.0.x/16  |                                         | • Tunnel IP: 10.200.0.y/16  |
| • Dedicated `panel-api`     |                                         | • Dedicated `panel-api`     |
| • Watchdog Auto-Reconnect   |                                         | • Watchdog Auto-Reconnect   |
| • Hotspot + Quota Engine    |                                         | • Hotspot + Quota Engine    |
+--------------+--------------+                                         +--------------+--------------+
               | LAN Bridge                                                            | LAN Bridge
               v                                                                       v
   [Downstream APs / POS / Cameras]                                        [Downstream APs / POS / Cameras]
   Discovered via /ip neighbor; reached via dynamic dst-nat proxy ports (`panel-proxy:<deviceId>`)
```

---

## 🚀 Key Architectural Pillars & Live Achievements

### 1. Hub-and-Spoke SSTP VPN
- **Zero Inbound Port Forwarding**: Every site router dials **outbound** over TCP 443 to `vpn.onetsbyblarch.online`. Survives complex NAT, CGNAT, and hotel captive portals.
- **Static Tunnel IP Addressing**: Each router receives an allocated static IP within `10.200.0.0/16` via `/ppp secret` `remote-address`.
- **Verified Let's Encrypt SSTP TLS**: Both RouterOS 6.49.17 and v7 client routers dial in with `verify-server-certificate=yes` and `verify-server-address-from-certificate=yes`.

### 2. Automated One-Liner Onboarding & Self-Healing Watchdog
- **15-Minute One-Time Tokens**: The panel issues short-lived cryptographic tokens.
- **Single Terminal Paste**:
  ```routeros
  /tool fetch mode=https url="https://api.onetsbyblarch.online/api/v1/onboard/<TOKEN>/onboard.rsc" dst-path=onboard.rsc check-certificate=no; :delay 2s; /import onboard.rsc
  ```
- **Idempotent Router Setup**: Provisions the SSTP client, configures least-privilege `panel-api` credentials, stamps the platform UUID, installs an auto-reconnect watchdog scheduler, burns the token, and flips the router to **`online`** automatically in the UI.

### 3. Bi-Directional RouterOS Synchronization & Device ID Reconciliation
- **`!done =ret=*id` Capture**: In RouterOS, `add` commands return `!done =ret=*X` rather than `!re`. The `@mtk/worker` commands processor captures this via `collectReplyRows` and directly reconciles the assigned RouterOS `.id` into PostgreSQL mirror tables (`hotspotUsers`, `hotspotServers`, `hotspotProfiles`, etc.).
- **Zero-Phantom Deletions**: If an entity in the UI was never assigned a physical RouterOS ID, deletion gracefully cleans up database state without throwing `422 Unprocessable Content`.
- **Atomic Safe-Apply**: Firewall mutations verify connectivity after 60 seconds; automatic rollback reverts bad rules if management connectivity is interrupted.

### 4. Real-Time Telemetry & TimescaleDB Hypertables
- **Sharded 60s Polling**: Background workers poll `/system/resource`, `/interface/monitor-traffic`, and `/ip/hotspot/active`.
- **Validation-Preserved Ingestion**: Solved NestJS `ValidationPipe({ whitelist: true })` stripping numeric metrics by applying `@IsNumber()` and `@Type(() => Number)` across all DTOs.
- **Time-Series Hypertables**: Real-time queries for `metric_cpu`, `metric_mem`, `metric_traffic`, and `metric_hotspot_active` with continuous rollups and zero data interpolation gaps.

### 5. PostgresVault Security (Zero Plaintext Secrets)
- **AES-256-GCM Encryption**: All per-router SSTP passwords and RouterOS API passwords are encrypted at rest in PostgreSQL (`_vault_secret`) using a Master KMS Key (`VAULT_MASTER_KEY`).
- **Secret Reference Architecture**: API responses and database tables only contain `sstpPasswordRef` and `apiPasswordRef`. Cleartext passwords never touch git, logs, or UI responses.

---

## 📁 Repository Structure

```
.
├── apps/
│   ├── api/                   # NestJS 11 Core API
│   │   ├── src/auth/          # JWT authentication, RBAC guards
│   │   ├── src/routers/       # Router inventory, status, and metadata
│   │   ├── src/provisioning/  # Onboarding tokens, RSC scripts, hub PPP sync
│   │   ├── src/hotspot/       # Hotspot servers, profiles, users, walled garden
│   │   ├── src/firewall/      # Firewall rules, address lists, safe-apply
│   │   ├── src/monitoring/    # Metrics ingestion, downtime ledger, heartbeats
│   │   ├── src/db/            # Prisma service, PostgresVault, TimescaleDB store
│   │   └── src/internal/      # Worker-facing authenticated internal endpoints
│   ├── worker/                # BullMQ Background Worker Fleet
│   │   ├── src/jobs/          # commands, poller, quota, expiry-sweep, backup
│   │   ├── src/connection-manager.ts # Persistent pooled RosConnection sessions
│   │   ├── src/health-monitor.ts     # 30s ping, 3-miss offline downtime ledger
│   │   └── src/registry.ts    # Dynamic HTTP router registry
│   └── web/                   # Next.js 15 App Router Frontend
│       ├── src/app/           # [locale] bilingual routing (Arabic RTL / English)
│       ├── src/components/    # shadcn/ui + Tailwind components
│       └── src/lib/api/       # React Query API client
├── packages/
│   ├── ros-api/               # Pure TypeScript RouterOS binary API client
│   │   ├── src/connection.ts  # Sentence parser, login flows (legacy + modern)
│   │   └── src/commands/      # Typed command builders
│   └── types/                 # Shared TypeScript interfaces & DTOs
├── infra/
│   ├── docker/                # Multi-stage Dockerfiles (api, worker, web)
│   ├── dokploy/               # Production compose.yml for Dokploy
│   └── ros-scripts/           # Device configuration and onboarding templates
└── docs/                      # Architectural specifications and runbooks
```

---

## 🛠️ Local Development & Quickstart

### Prerequisites
- Node.js 22.x or later
- pnpm 9.x (`corepack enable pnpm`)
- Docker & Docker Compose (for local PostgreSQL & Redis)

### Setup Instructions

```bash
# 1. Clone repository
git clone https://github.com/blonets/onetsbyblarchsystems.git
cd onetsbyblarchsystems

# 2. Install monorepo dependencies
pnpm install

# 3. Environment configuration
cp .env.example .env
# Edit .env with your local credentials and master keys

# 4. Run tests and typecheck
pnpm typecheck
pnpm test

# 5. Build all packages and applications
pnpm build

# 6. Start full stack in development mode
pnpm dev
```

### Running Individual Services

```bash
# Pure protocol unit tests (mock RouterOS, zero network required)
pnpm --filter @mtk/ros-api test

# NestJS API development (port :3001)
pnpm --filter @mtk/api dev

# BullMQ Worker development
pnpm --filter @mtk/worker dev

# Next.js Web Dashboard development (port :3000)
pnpm --filter @mtk/web dev
```

---

## 🧪 Testing & Verification

The codebase adheres to strict test-driven reliability standards:

- **106 Unit & Integration Tests** in `@mtk/api`: Covers auth guards, hotspot mutations, safe-apply rollback drills, audit logging, and PostgresVault encryption.
- **103 Unit & Protocol Tests** in `@mtk/worker`: Covers RosConnection sentence decoding, MD5-challenge vs modern logins, command dispatching, poller rate tracking, and downtime calculations.
- **Live Hardware Verification**: Verified on RouterOS 6.49.17 and RouterOS v7 hardware CHRs. See [docs/LIVE-VERIFICATION.md](file:///home/arnob/onetsbyblarchsystems/docs/LIVE-VERIFICATION.md) for full audit trails.

---

## 📄 Documentation Sitemap

- [System Architecture](file:///home/arnob/onetsbyblarchsystems/docs/ARCHITECTURE.md) — Topology, component inventory, security boundaries, and protocol details.
- [Live Verification Runbook](file:///home/arnob/onetsbyblarchsystems/docs/LIVE-VERIFICATION.md) — Hardware verification evidence, live tests, and sign-offs.
- [Technician Onboarding Guide (العربية)](file:///home/arnob/onetsbyblarchsystems/docs/ONBOARDING.md) — Step-by-step site technician manual in Egyptian Arabic.
- [Database Data Model](file:///home/arnob/onetsbyblarchsystems/docs/DATA-MODEL.md) — Prisma schema, TimescaleDB hypertables, and audit structures.
- [Project Roadmap](file:///home/arnob/onetsbyblarchsystems/docs/ROADMAP.md) — Phase gates, exit criteria, and upcoming Phase 2 scale-out modules.

---

## 🔒 Security & Operational Discipline

1. **No Plaintext Passwords**: Database holds encrypted KMS references only.
2. **Tunnel Isolation**: Site routers accept RouterOS API commands exclusively from the `10.200.0.0/16` tunnel supernet.
3. **Audit Trail**: Every mutation (`POST`, `PATCH`, `DELETE`) generates an immutable `AuditLog` row with operator identity, before/after states, and RouterOS execution results.
4. **Automated Recovery**: Routers include watchdog schedulers that auto-heal SSTP tunnels within 2 minutes of transient disconnects.
