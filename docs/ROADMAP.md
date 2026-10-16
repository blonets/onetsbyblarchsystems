# Roadmap — MikroTik Fleet Management Platform

Phases are gated: a phase's **exit criteria** must be verified before the next phase's
implementation starts. **Phase 2 features land as NEW NestJS modules on the existing
event bus — no rewrites of Phase 0/1 code.**

Event-bus contract (stable from Phase 0 exit): `events.emit(name, payload)` where
`name ∈ router.online | router.offline | hotspot.user.login | hotspot.user.logout |
quota.exceeded | backup.completed | config.changed | alert.raised`. New modules
subscribe; they never patch existing modules.

---

## Status snapshot & Phase 0→1 completion checklist (updated 2026-10-16)

**Verified — evidence on real hardware / CI**
- CI green on `main` (GitHub Actions: install / typecheck / test / build).
- SSTP hub-and-spoke proven live on real CHRs (RouterOS 6.49.17): hub
  `34.91.70.17`, test site `34.12.242.142`, static tunnel IP `10.200.0.2`,
  ping 0% loss; DNS-based dialing via `vpn.onetsbyblarch.online:443`.
- Let's Encrypt on SSTP fully working: hub serves the LE cert (Gen-Y chain
  YR2 → Root YR); the test client validates with
  `verify-server-certificate=yes` +
  `verify-server-address-from-certificate=yes`, tunnel up.
- Direct ros-api verification against the test CHR (2026-10-16): hotspot
  user CRUD, firewall filter add/move/remove, queue simple add/set/remove,
  system backup create + config export — all PASS.
- Phase 1 code (NestJS modules, worker jobs, Arabic dashboard) is written
  and CI-green — panel-driven end-to-end verification is still open (below).
- Migration `0002_timescale` failure root-caused + fixed (2026-10-16):
  its continuous aggregate was created `WITH DATA`, which cannot run
  inside Prisma's per-migration transaction (P3018 on apply → P3009
  blocking every later deploy). Fixed by creating the aggregate
  `WITH NO DATA`; all 3 migrations applied cleanly via a real
  `prisma migrate deploy` on a fresh TimescaleDB (25 tables,
  4 hypertables, the aggregate, 6 background jobs), and the exact
  production failure state (P3018 → P3009) was simulated locally with
  the recovery (`migrate resolve --rolled-back` + deploy of the fixed
  migration) proven end-to-end. The api entrypoint now carries an
  env-gated one-shot resolve fallback (`PRISMA_RESOLVE_ROLLED_BACK`,
  default-off).
- Full local stack test passed (2026-10-16): api boots + `/health` 200;
  internal endpoints return 401 without/with a wrong key, the router
  list with the key, 404 for an unknown router; the worker boots
  against the api, survives the api being killed (logs + retries, no
  crash), and recovers when it returns; web standalone serves `/en`
  200. LOCAL evidence only — production is not redeployed yet (gate
  below).

**Open — everything remaining between here and Phase 1 exit**
- [ ] Production deployment accepted (deployment gate, Phase 1 exit) —
      both original blockers are fixed and proven on a local stack
      (2026-10-16), but production has NOT been redeployed: the gate is
      now blocked on the vault implementation (below) + the deploy
      batch (below).
- [x] Worker↔API internal contract implemented (Phase 1 scope item 7) —
      implemented in the working copy 2026-10-16 (new
      `apps/api/src/internal` module, 6 endpoints; worker auth unified
      on `x-internal-key`; resilience fixed) and verified on the local
      stack test. Push + production-live proof ride the deploy batch
      (the Phase 1 *exit* criterion stays open until then).
- [ ] Persistent vault implementation — **production blocker**: the
      only `VaultPort` implementation is `InMemoryVault`, so router
      passwords would be lost on any api restart. Decision pending
      (owner): AES-256-GCM encrypted Postgres vault (`VAULT_MASTER_KEY`
      env) vs a HashiCorp Vault service. Must land before the deploy
      batch.
- [ ] Deploy batch (one push, one redeploy): compose env gaps found by
      the 2026-10-16 env-contract audit — `PANEL_PUBLIC_HOST` missing
      from the api env (`getOrThrow`: the api would crash at boot;
      value = `api.onetsbyblarch.online`) and the CORS name mismatch
      (code reads `CORS_ORIGINS`, compose sets `CORS_ORIGIN`) — plus
      `INTERNAL_API_KEY` + worker `API_BASE_URL` (already added to the
      compose in the working copy), Dokploy env values incl. the
      one-shot `PRISMA_RESOLVE_ROLLED_BACK`, then domain verification.
- [ ] Panel-driven end-to-end verification: hotspot round-trip incl. quota
      enforcer; firewall safe-apply rollback demonstration; monitoring
      persistence + Socket.IO live proof; downstream device discovered via
      proxy port; backup → factory-reset → restore smoke test.
- [ ] 7-day soak on ≥3 test routers (Phase 1 exit).
- [ ] SSTP secret rotation demonstrated in-panel (secret create/delete
      proven via the API only).
- [ ] LE renewal automation installed on the Dokploy VPS (scope item 9;
      files written, install pending; cert expires 2027-01-14; backstop
      reminder 2026-12-15).
- [ ] Hub hardening before production traffic (scope item 10).

**Pending owner / ops decisions**
- SMTP values — to be filled by the owner in the Dokploy compose env.
- GitHub App access for webhook auto-deploy — the compose currently uses a
  custom git source, so redeploys are manual until access is granted.

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
- [x] `ci.yml` green: lint + typecheck + unit tests for ros-api against a mock
      RouterOS API server.
      (verified 2026-10-16 — GitHub Actions green on `main`: install /
      typecheck / test / build, most recently on the Dokploy-restructure
      commit)
- [ ] One test CHR onboarded with the one-line paste: SSTP tunnel up, router row
      created with UUID, status online in panel.
      (partially verified 2026-10-16 — the tunnel itself is proven live on
      real CHRs via the onboarding scripts: hub `34.91.70.17`, test site
      `34.12.242.142`, static tunnel IP `10.200.0.2`, ping 0% loss, client
      verifying the hub's Let's Encrypt cert; router row + UUID + online
      status driven through the panel NOT yet demonstrated — rolled into
      Phase 1 exit)
- [ ] Panel can run a read command (`/system resource print`) and a write command
      (set identity name) on the test router; both appear in AuditLog.
      (partially verified 2026-10-16 — read/write proven via direct ros-api
      calls against the test CHR: hotspot user CRUD, firewall filter
      add/move/remove, queue simple add/set/remove, backup create + config
      export, all PASS; panel-driven proof + AuditLog entries belong to
      Phase 1 exit)
- [ ] Provisioning can rotate the router's SSTP secret without losing management.
      (open — PPP secret create/delete proven via the API; in-panel rotation
      without losing management NOT yet demonstrated)

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
7. **Worker↔API internal contract** — the API implements the worker-facing
   internal endpoints the worker is built against: `GET /internal/worker/routers`
   (list), `GET /internal/worker/routers/:id/endpoint`, `.../provision-info`,
   `POST .../fresh-secrets`, `POST .../decommission`,
   `POST /internal/worker/audit`. Auth is unified on the API's existing
   internal scheme (`x-internal-key` header against `INTERNAL_API_KEY`).
   Contract mismatch discovered 2026-10-16: the worker currently sends
   `Bearer $WORKER_SERVICE_TOKEN` and defaults to `http://localhost:3000`.
   The worker must also treat API fetch failures as retryable (log + retry
   on the next poll cycle), never crash the process.
   (status 2026-10-16: IMPLEMENTED in the working copy — new
   `apps/api/src/internal` module with all six endpoints reusing the
   routers/provisioning/audit/vault services; worker aligned to
   `x-internal-key`; fetch failures made retryable at the
   health-monitor/poller level. Builds green; worker tests 89 passed,
   api tests 58 passed; verified on the local stack test, including
   the worker surviving a killed api. Push + production proof pending
   the deploy batch.)
8. **Migration discipline** — every Prisma migration is proven against a
   fresh TimescaleDB (local Docker) before it ships. A migration that fails
   in production blocks all subsequent deploys (Prisma P3009) until it is
   resolved, so migrations are rehearsed, never first-run in production.
   (status 2026-10-16: this discipline exists because of a real failure —
   `0002_timescale` shipped unrehearsed and failed in production: its
   continuous aggregate was created `WITH DATA`, illegal inside Prisma's
   per-migration transaction. Root-caused, fixed with `WITH NO DATA`,
   and the full migration set + the P3009 recovery procedure proven
   against a fresh TimescaleDB locally the same day.)
9. **Hub certificate renewal** — the SSTP hub's Let's Encrypt certificate
   (expires 2027-01-14) renews automatically: renewal script + systemd
   timer for the Dokploy VPS. (status 2026-10-16: automation files written;
   installation on the VPS pending; backstop reminder 2026-12-15.)
10. **Hub hardening (pre-production)** — restrict public management
    exposure on the hub (RouterOS API / SSH / FTP reachable only via the
    tunnel, the VPS, or approved sources), run the platform under a
    dedicated least-privilege RouterOS user (the compose currently uses
    the hub `admin` account), and disable unneeded public services.

**Entry criteria**
- Phase 0 exit criteria all verified on the test CHR.
  (status 2026-10-16: the transport-layer criteria are verified live —
  see the Phase 0 exit notes; the panel-driven criteria are rolled into
  this phase's exit criteria and the completion checklist above)

**Exit criteria**
- [ ] Hotspot user CRUD round-trip on test CHR from the panel (create → login test →
      disable → delete), quota enforcer disables an over-quota user within 5 min.
      (in code, CI-green; direct ros-api hotspot user CRUD PASS 2026-10-16 —
      panel round-trip + quota enforcer NOT yet verified)
- [ ] Firewall rule add/remove + reorder from panel; safe-apply rollback demonstrated
      by pushing a rule that blocks management and watching auto-revert.
      (in code, CI-green; direct ros-api filter add/move/remove PASS
      2026-10-16 — panel proof + safe-apply rollback demonstration NOT yet
      done)
- [ ] Monitoring proof: poller metrics persist into the TimescaleDB
      hypertables, and Socket.IO live status in the panel reflects a forced
      disconnect / reconnect of a test router.
      (in code, CI-green — NOT yet verified live)
- [ ] 7-day soak on ≥3 test routers: downtime ledger matches forced-disconnect windows
      within ±60 s; zero lost backups; poller gap < 2%.
      (open — not started; the soak duration cannot be compressed)
- [ ] Backup → factory-reset → restore smoke test: router returns to managed state.
      (in code, CI-green; system backup create (24,048 bytes) + config
      export PASS via direct ros-api 2026-10-16 — factory-reset / restore
      smoke test NOT yet done)
- [ ] Downstream device discovered and reachable via allocated proxy port.
      (in code, CI-green — NOT yet verified live)
- [ ] Worker↔API internal contract live (scope item 7): the worker lists
      and polls routers through `/internal/worker/*` with unified
      internal-key auth, and rides out an API outage by retrying — no
      crash loop.
      (implemented + locally verified 2026-10-16 — the endpoints answer
      correctly in the local stack test and the worker rode out a killed
      api without crashing; production-live proof pending the deploy
      batch, which is gated on the vault implementation)
- [ ] Deployment gate: the platform is live via the Dokploy compose on its
      production domains (`admin.` / `api.onetsbyblarch.online`) with
      valid TLS, api `/health` green, worker stable across poll cycles,
      and all migrations applied cleanly on a fresh database.
      (blocked-by — production NOT yet redeployed. The two original
      causes are fixed and locally proven (migration `0002_timescale`
      root-caused + fixed; internal contract implemented; full local
      stack test passed 2026-10-16). Remaining blockers: the vault is
      in-memory only — a production blocker with the implementation
      decision pending — and the deploy batch itself: compose env
      fixes + push + Dokploy env + one redeploy + domain verification)

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
6. **Downstream device drivers** — per-vendor config drivers behind the Phase 1
   vendor-neutral `DeviceDriver` contract (new `drivers` module; vendors: RouterOS API,
   OpenWrt UCI-over-SSH, DD-WRT, UniFi). Fleet reality: downstream is ~95% OpenWrt
   (+ DD-WRT/Ubiquiti/Cisco); Phase 1 proxy-port access keeps working standalone —
   drivers are opt-in per device.
7. **CVE feed** — RouterOS security advisory tracking per fleet version; alert when a
   managed router runs a version with known CVEs (new `cve` module; subscribes:
   `router.online`, version inventory).
8. **Backup health endpoint + diff** — per-router backup health status
   (last success age, size drift) plus config diff between consecutive backups
   (extends `backups` via its public interface; emits: `backup.unhealthy`).
9. **Serial→suspect detection** — quarantine flow for duplicate/suspect router
   identity (same UUID or serial seen from 2 tunnel IPs); operator approval gate,
   audit-logged (extends `provisioning` + `routers`; emits: `router.suspect`).
10. **Last-seen / last-check columns** — fleet-wide "last seen" and "last successful
    check" columns with staleness highlighting on the routers table (web + API
    read models; no new tables).
11. **Metric threshold alert rules** — user-defined thresholds on polled metrics
    (CPU %, memory %, interface errors, hotspot-active count) → `alert.raised`
    (new `alerts` module; subscribes to metrics ingest).
12. **panel-api permission self-check** — scheduled verification that every managed
    router's `panel-api` user still has exactly the least-privilege policy set;
    auto-remediate drift + alert (extends `provisioning`; emits: `config.drift`).
13. **Upgrade orchestration** — staged RouterOS upgrades across the fleet
    (canary → batches → all), with pre-upgrade backup gate and rollback on
    failed health check (new `upgrades` module).
14. **Central syslog** — per-router remote-logging configuration + centralized
    log ingest, retention, and search (new `syslog` module).
15. **Bulk CLI** — run an arbitrary allow-listed RouterOS command across a router
    selection with per-router results and audit (extends `commands`; RBAC-gated,
    superadmin/operator only).
16. **Encrypted portability** — export/import the platform's own state
    (routers, secrets references, config) as an encrypted bundle for panel
    migration (new `portability` module; KMS-managed key).
17. **Prometheus /metrics** — platform-internal metrics endpoint (queue depths,
    poller lag, session counts, API latencies) for external monitoring
    (extends `monitoring`; no new tables).

**Entry criteria**
- Phase 1 exit criteria verified (tracked in the status snapshot /
  completion checklist at the top of this document); ≥10 production
  routers stable for 30 days.

**Exit criteria** (per module)
- [ ] Module ships behind a feature flag, subscribes only to documented bus events,
      adds no columns to Phase 0/1 tables (own tables, FKs only).
- [ ] No regression in Phase 1 soak suite.

---

## Non-goals (all phases)
- Replacing RouterOS (we orchestrate it, we don't reimplement it).
- Managing routers outside the SSTP tunnel (no direct WAN management, ever).
- Storing any credential in plaintext — DB holds references only.
