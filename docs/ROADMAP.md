# Roadmap — MikroTik Fleet Management Platform

Phases are gated: a phase's **exit criteria** must be verified before the next phase's
implementation starts. **Phase 2 features land as NEW NestJS modules on the existing
event bus — no rewrites of Phase 0/1 code.**

Event-bus contract (stable from Phase 0 exit): `events.emit(name, payload)` where
`name ∈ router.online | router.offline | hotspot.user.login | hotspot.user.logout |
quota.exceeded | backup.completed | config.changed | alert.raised`. New modules
subscribe; they never patch existing modules.

---

## Phase 0 — Foundation

**Goal:** monorepo builds, one router fully manageable end-to-end via the panel.

**Scope**
- Monorepo scaffold (pnpm workspaces / turbo): `packages/ros-api`, `apps/api`,
  `apps/worker`, `apps/web`, `infra/ros-scripts`, `infra/dokploy/compose.yml`,
  `.github/workflows/ci.yml`.
- `packages/ros-api`: binary word protocol, both login flows (pre-6.43 challenge +
  6.43+/v7 direct), typed builders for system/ip/interface/ppp domains, typed errors.
- `apps/api`: auth (JWT) + RBAC, `sites`, `routers`, `provisioning`
  (onboarding-token issue/burn, hub `/ppp secret` create/rotate/delete via ros-api),
  `audit`.
- `apps/worker`: connection-manager (persistent sessions, reconnect/backoff),
  one `commands` queue.
- `infra/ros-scripts/onboard.rsc` + `watchdog.rsc` (templates with placeholders).
- Docker multi-stage builds; Dokploy compose (postgres+timescale, redis, api, worker, web).

**Entry criteria**
- Architecture doc (ARCHITECTURE.md) approved; hub CHR reachable plan confirmed.

**Exit criteria**
- [ ] `ci.yml` green: lint + typecheck + unit tests for ros-api against a mock
      RouterOS API server.
- [ ] One test CHR onboarded with the one-line paste: SSTP tunnel up, router row
      created with UUID, status online in panel.
- [ ] Panel can run a read command (`/system resource print`) and a write command
      (set identity name) on the test router; both appear in AuditLog.
- [ ] Provisioning can rotate the router's SSTP secret without losing management.

## Phase 1 — Fleet operations

**Goal:** run real sites — hotspot business, firewall, shaping, visibility, safety nets.

**Scope** (each a NestJS module in `apps/api` + worker jobs + web UI)
1. **Hotspot v1** — full CRUD: servers, server-profiles, users, user-profiles,
   walled-garden, walled-garden-ip; time/rate/shared-users limits; quota via the
   scheduled `quota-enforcer` (BullMQ repeatable job).
2. **Firewall manager** — filter/nat/mangle/address-list CRUD with rule ordering
   (place-before), safe-apply (auto-rollback on lost heartbeat — the worker verifies
   the router is still reachable 60 s after a filter change).
3. **Queues manager** — simple queues + queue trees per site/user.
4. **Monitoring** — sharded pollers (60 s), TimescaleDB hypertables, downtime ledger
   (open/close with durations), Socket.IO live status, alerting (Telegram/email).
5. **Backups/restore** — scheduled `/export` + binary backup, encrypted at rest,
   retention janitor, one-click restore.
6. **Downstream-device proxy** — `/ip neighbor` discovery, platform-managed dst-nat
   (`comment=panel-proxy:<deviceId>`), port allocation, cascade registration of
   downstream MikroTiks.

**Entry criteria**
- Phase 0 exit criteria all verified on the test CHR.

**Exit criteria**
- [ ] Hotspot user CRUD round-trip on test CHR from the panel (create → login test →
      disable → delete), quota enforcer disables an over-quota user within 5 min.
- [ ] Firewall rule add/remove + reorder from panel; safe-apply rollback demonstrated
      by pushing a rule that blocks management and watching auto-revert.
- [ ] 7-day soak on ≥3 test routers: downtime ledger matches forced-disconnect windows
      within ±60 s; zero lost backups; poller gap < 2%.
- [ ] Backup → factory-reset → restore smoke test: router returns to managed state.
- [ ] Downstream device discovered and reachable via allocated proxy port.

## Phase 2 — Monetization & scale-out (NEW modules, no rewrites)

Each item is a **new** NestJS module subscribing to the Phase 0 event bus + new web
pages. Existing modules are extended only via their public service interfaces.

1. **Vouchers** — batch generation, print templates, activation tracking
   (subscribes: `config.changed`, emits: `voucher.redeemed`).
2. **Billing/accounting** — plans, invoices, payment status per site; usage rollups
   from TimescaleDB continuous aggregates (subscribes: `voucher.redeemed`, `quota.exceeded`).
3. **Notifications** — multi-channel (email/SMS/Telegram/WhatsApp) templates on bus
   events (subscribes: `router.offline`, `alert.raised`, `backup.completed`…).
4. **CAPsMAN orchestration** — managed AP provisioning through the tunnel cascade
   (new `capsman` module; reuses `provisioning` + `downstream`).
5. **RADIUS plugin** — external auth/accounting for hotspot (new `radius` module;
   hotspot v1 keeps working standalone — RADIUS is an opt-in server-profile switch).

**Entry criteria**
- Phase 1 exit criteria verified; ≥10 production routers stable for 30 days.

**Exit criteria** (per module)
- [ ] Module ships behind a feature flag, subscribes only to documented bus events,
      adds no columns to Phase 0/1 tables (own tables, FKs only).
- [ ] No regression in Phase 1 soak suite.

---

## Non-goals (all phases)
- Replacing RouterOS (we orchestrate it, we don't reimplement it).
- Managing routers outside the SSTP tunnel (no direct WAN management, ever).
- Storing any credential in plaintext — DB holds references only.
