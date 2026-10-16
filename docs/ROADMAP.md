# Roadmap — MikroTik Fleet Management Platform

Phases are gated: a phase's **exit criteria** must be verified on live hardware before the next phase's implementation starts. **Phase 2 features land as NEW NestJS modules on the existing event bus — no rewrites of Phase 0/1 code.**

Event-bus contract (stable from Phase 0 exit): `events.emit(name, payload)` where
`name ∈ router.online | router.offline | hotspot.user.login | hotspot.user.logout | quota.exceeded | backup.completed | config.changed | alert.raised`. New modules subscribe; they never patch existing modules.

---

## 🚦 Phase Completion Summary

| Phase | Milestone | Status | Key Deliverables |
|---|---|---|---|
| **Phase 0** | **Foundation & SSTP Mesh** | 🟢 **COMPLETED & VERIFIED** | Pure TypeScript ros-api, Hub CHR SSTP server, DNS dialing (`vpn.onetsbyblarch.online`), auto-onboarding token & RSC generator, BullMQ queues, Docker/Dokploy scaffold. |
| **Phase 1** | **Fleet Operations & Monitoring** | 🟢 **COMPLETED & VERIFIED** | Hotspot full CRUD & bi-directional reconciliation, safe-apply rollback firewall, sharded 60s poller & TimescaleDB hypertables, downtime ledger, bilingual dashboard (Arabic RTL / English), persistent AES-256-GCM PostgresVault. |
| **Phase 2** | **Monetization & Fleet Scale-Out** | 🟡 **IN PROGRESS / PLANNED** | Voucher batch generator, billing & invoicing, multi-channel alerts (Telegram/WhatsApp), CAPsMAN orchestration, downstream OpenWrt/UniFi drivers, central syslog. |

---

## ✅ Phase 0 — Foundation (Verified Live)

**Goal:** Monorepo builds cleanly; one router fully manageable end-to-end via the panel.

### Exit Criteria Audit
- [x] **CI Green**: Lint + typecheck + unit tests for `packages/ros-api` (103 worker tests, 106 API tests).
- [x] **Live SSTP Mesh**: Real hardware CHRs (RouterOS 6.49.17) dialed `vpn.onetsbyblarch.online:443`, verified Let's Encrypt certificate, assigned static IP in `10.200.0.0/16`, 0% packet loss.
- [x] **Dual Login Protocol**: Verified modern direct login (`6.43+/v7`) and legacy MD5 challenge-response (`<6.43`).
- [x] **Automated Provisioning**: One-liner `/tool fetch` script executed on client router; created `panel-api` user, stamped UUID into `/system note`, burned token, and updated panel state.
- [x] **Audit Trail**: Every read/write action records an immutable `AuditLog` row with before/after state snapshots.

---

## ✅ Phase 1 — Fleet Operations (Verified Live)

**Goal:** Run real sites — hotspot business, firewall management, shaping, real-time visibility, safety nets.

### Exit Criteria Audit
- [x] **Hotspot CRUD & ID Reconciliation**:
  - Full round-trip: servers, profiles, users, and walled garden.
  - Implemented `collectReplyRows` to capture `.id` from RouterOS `!done =ret=*X` responses.
  - Reconciled device IDs into PostgreSQL `HotspotUser.mikrotikId` and `HotspotServer.mikrotikId`.
  - Resolved `422 Unprocessable Content` errors on `PATCH` and `DELETE`.
  - Graceful direct deletion for unreconciled/phantom records.
- [x] **Firewall Safe-Apply & Rollback**:
  - Filter rule add, re-order (`place-before`), and remove verified.
  - Safe-apply rollback watchdog auto-reverts bad rules if connection drops.
- [x] **Real-Time Telemetry & TimescaleDB Ingestion**:
  - 60s sharded poller queries `/system/resource`, `/interface/monitor-traffic`, and `/ip/hotspot/active`.
  - Fixed NestJS `ValidationPipe({ whitelist: true })` numeric DTO stripping by applying `@IsNumber()`.
  - Continuous ingestion verified live into `metric_cpu`, `metric_mem`, `metric_traffic`, and `metric_hotspot_active`.
  - Dashboard API queries return real time-series metrics (`HTTP 200 OK`).
- [x] **Downtime Ledger & Health Monitoring**:
  - 30s ping sweep; 3 missed heartbeats opens a `Downtime` row and marks router `offline`.
  - Reconnection closes the open downtime row and records exact duration in seconds.
- [x] **Persistent PostgresVault**:
  - Replaced in-memory stub with persistent `PostgresVault` using AES-256-GCM encryption in `_vault_secret`.
  - Zero plaintext credentials stored in database tables or logs.
- [x] **Dokploy Production Deployment**:
  - Successfully deployed on Dokploy stack `compose-synthesize-1080p-bandwidth-bo6rcx`.
  - Live domains: `admin.onetsbyblarch.online` (Web), `api.onetsbyblarch.online` (API), `vpn.onetsbyblarch.online` (CHR Hub).
- [x] **Watchdog Self-Healing**:
  - Embedded 2-minute scheduler on site routers auto-restarts SSTP tunnels upon transient failure.

---

## 🚀 Phase 2 — Monetization & Scale-Out (Architecture & Scope)

Each Phase 2 feature lands as an independent NestJS module subscribing to event bus signals without touching Phase 0/1 core logic.

```
                         Event Bus (BullMQ / Internal Events)
        [router.online]   [hotspot.user.login]   [quota.exceeded]   [alert.raised]
               |                    |                    |                 |
               v                    v                    v                 v
        +--------------+     +--------------+     +--------------+  +--------------+
        | Vouchers &   |     | Billing &    |     | Multi-Channel|  | CAPsMAN & AP |
        | Printing     |     | Invoicing    |     | Alerts       |  | Orchestrator |
        +--------------+     +--------------+     +--------------+  +--------------+
```

### Planned Phase 2 Modules

1. **Voucher System** (`apps/api/src/vouchers`):
   - Batch voucher code generation (alphanumeric, custom prefix, length).
   - Printable thermal receipt and card templates (Arabic RTL layout).
   - Activation tracking, batch expiration dates, and status lifecycle (`unredeemed`, `active`, `depleted`, `expired`).
   - Subscribes to: `config.changed`, emits: `voucher.redeemed`.

2. **Billing & Accounting** (`apps/api/src/billing`):
   - Tenant subscription plans, monthly revenue tracking, and invoice generation.
   - Revenue aggregation from TimescaleDB continuous aggregates.
   - Subscribes to: `voucher.redeemed`, `quota.exceeded`.

3. **Multi-Channel Notifications** (`apps/api/src/notifications`):
   - Instant alerting via Telegram Bot, WhatsApp Business API, and SMTP email.
   - Configurable alerting rules per tenant (e.g. router offline > 5m, CPU > 90% for 10m).
   - Subscribes to: `router.offline`, `alert.raised`, `backup.completed`.

4. **CAPsMAN & Managed AP Orchestration** (`apps/api/src/capsman`):
   - Centralized Wi-Fi configuration management across site APs.
   - Radio provisioning, SSID management, and channel optimization through tunnel cascade.

5. **Downstream Multi-Vendor Drivers** (`apps/api/src/drivers`):
   - Automated discovery and management of downstream network hardware behind site routers.
   - Drivers for OpenWrt (UCI-over-SSH), Ubiquiti UniFi, and DD-WRT.
   - Dynamic port-forward proxying (`panel-proxy:<deviceId>`).

6. **Automated RouterOS Firmware Upgrades** (`apps/api/src/upgrades`):
   - Fleet-wide staged upgrade orchestration (Canary branch → Pilot batch → All).
   - Mandatory pre-upgrade backup gate with auto-rollback on failed post-upgrade health check.

7. **Centralized Remote Syslog** (`apps/api/src/syslog`):
   - Configures `/system logging action add target=remote` on site routers.
   - Collects, indexes, and enables full-text search of router system logs in the web dashboard.

---

## 🛡️ Non-Negotiable Operational Principles

1. **We Orchestrate, Not Reimplement**: RouterOS executes network operations; the platform manages intent, states, and telemetry.
2. **Tunnel-Only Management**: No site router ever opens management ports (API, WinBox, SSH) to the public WAN.
3. **No Plaintext Passwords**: Database holds encrypted KMS references only.
4. **Idempotence & Rollback**: Every state mutation is repeatable and reverts cleanly upon interruption.
