# Architecture — MikroTik Fleet Management Platform

Status: **locked** (2026-10-16). Do not relitigate; extend, don't redesign.

## 1. Topology (ASCII)

```
                                +------------------------------+
                                |        PLATFORM (VPS/Dokploy)  |
                                |  apps/web  (Next.js, Next-intl|
                                |             AR RTL / EN)       |
                                |  apps/api  (NestJS REST +     |
                                |             Socket.IO)         |
                                |  apps/worker (BullMQ queues)  |
                                |  postgres+timescale / redis   |
                                +--------------+-----------------+
                                               | tunnel-side svc IP 10.200.0.1
                                               v
+=============================================================================+
|  HUB MikroTik CHR — SSTP server only (TCP 443)                              |
|  • /interface sstp-server server: enabled=yes port=443 authentication=      |
|      mschap2 certificate=<server-cert> tls-version=only-1.2 pfs=yes        |
|      force-aes=yes default-profile=ppp-profile-panel                        |
|  • /ppp secret per router: name=<uuid-based user> password=<unique>        |
|      service=sstp profile=ppp-profile-panel remote-address=<static IP>     |
|      (10.200.x.y out of 10.200.0.0/16)                                     |
|  • input filter: allow tcp/443 from anywhere (clients dial from anywhere)  |
+====================+===============+===============+========================+
                     |               |               |
        TCP 443 SSTP (dialed OUT from the site routers — survives NAT/CGNAT,
        no public IP needed at the site, single outbound port)
                     |               |               |
     +---------------+--+ +----------+------+ +------+-------------+
     | Site router #1     | | Site router #2    | | Site router #3 ...  |
     | (v5 / v6 / v7)     | | (v5 / v6 / v7)    | |                    |
     | • firewall +       | | • firewall +      | |  ~1000+ routers    |
     |   hotspot (resold  | |   hotspot (resold | |  same shape        |
     |   internet)        | |   internet)       | |                    |
     | • SSTP client →    | | • SSTP client →   | |                    |
     |   SSTP_HUB_HOST    | |   SSTP_HUB_HOST   | |                    |
     |   (DNS, env-only)  | |   (DNS, env-only) | |                    |
     | • tunnel IP static | | • tunnel IP static| |                    |
     | • restricted API   | | • restricted API  | |                    |
     |   user "panel-api" | |   user "panel-api" | |                    |
     | • watchdog sched.  | | • watchdog sched. | |                    |
     +--+----+----+-------+ +---+---+---+-------+ +---+----+---+-------+
        |    |    |                LAN side (bridge/hotspot network)
        v    v    v
   [APs, cameras, POS terminals, switches — downstream devices]
   • discovered via /ip neighbor (MNDP/LLDP/CDP)
   • reached via platform-managed dst-nat on the site router:
       comment=panel-proxy:<deviceId>
       dst-address=<router tunnel IP> dst-port=<allocated>
       → to-addresses=<LAN IP> to-ports=<22|80|443|8728|8291>
   • downstream MikroTiks register as managed routers through the tunnel (cascade)
```

### Addressing
- Tunnel supernet: `10.200.0.0/16`
- Hub tunnel-side address: `10.200.0.1/16` on the server side
- Every site router gets a **static** tunnel IP via `/ppp secret remote-address`
- All management traffic (RouterOS API, backups, callbacks) flows **inside** the tunnel; the
  site router's LAN and WAN are never directly reachable from the platform.

### Why this shape
- One outbound TCP connection (443) per router → passes through NAT, CGNAT, and most
  hotel/cafe firewalls (looks like HTTPS).
- Hub address is referenced only by the env var `SSTP_HUB_HOST` on the routers' SSTP client
  (`connect-to=$SSTP_HUB_HOST`). Panel and hub can move / get replaced without touching
  a single site router.
- Per-router identity = three linked anchors:
  1. `/ppp secret` name (= unique SSTP username)
  2. `remote-address` = static tunnel IP
  3. platform `Router.uuid` stamped into the router: `/system identity` exposes only
     `name` (no `comment` property — verified against official Identity docs), so the
     UUID is stamped via `/system note set note="panel-uuid=<uuid>"` plus the identity
     name carrying the site slug (≤64 chars).

## 2. Component inventory

### packages/ros-api (pure TypeScript, zero runtime deps)
- **Binary word protocol**: variable-length word encoding, sentences terminated by a
  zero-length word; tag matching for concurrent commands.
- **Two login flows** (RouterOS API manual):
  - pre-6.43: send `/login` → server returns `=ret=<challenge>` → reply `/login`
    `=name=<user>` `=response=00<md5>` (MD5 of `\x00` + password + challenge).
  - 6.43+ / v7: single `/login` with `=name=<user>` `=password=<pass>`.
- **Connection**: TCP 8728 (plain) over the tunnel, optionally 8729 (api-ssl).
  The port is **per-router configurable** (`Router.apiPort`/`apiSslPort`): routers in
  the field may run custom service ports (e.g. the hub CHR runs SSH 8922 / Telnet 8923 /
  FTP 8921 / WWW 8980 instead of defaults), so ros-api must never hard-code ports.
  Input firewall on every site router only accepts API from `10.200.0.0/16`.
- **Typed builders** per domain (no raw string munging in app code):
  - `hotspot` — server, server-profile, user, user-profile, walled-garden, walled-garden-ip
  - `firewall` — filter/nat/mangle/address-list
  - `queues` — simple, tree
  - `system` — resource, identity, routerboard, packages, backup, export, scheduler, script
  - `ip` — neighbor, address, dhcp-server, pool, service
  - `ppp` — secret, active, profile (hub-side, used by provisioning)
  - `interface` — sstp-client, print/monitor
- Every command carries a correlation id; `!trap`/`!fatal` responses map to typed errors.

### apps/api (NestJS)
Modules: `auth` (JWT + RBAC roles: admin, operator, technician, viewer), `sites`,
`routers`, `provisioning` (onboarding tokens, hub `/ppp secret` lifecycle via ros-api),
`hotspot`, `firewall`, `queues`, `monitoring`, `backups`, `notifications`,
`downstream` (device proxy ports), `audit`.
- REST for CRUD/config; Socket.IO rooms per router/site for live status.
- All router-touching work is **enqueued** to BullMQ — the API never holds a router
  connection itself (keeps API stateless and horizontally scalable).

### apps/worker (BullMQ consumers)
- **connection-manager**: owns the persistent RouterOS API sessions. One session pool
  entry per router; reconnect with exponential backoff + jitter; session health ping
  every 30 s. API session drop → re-login (both flows), resume queue.
- **poller-<shard>**: metrics polling sharded by `hash(router.id) % SHARDS`
  (SHARDS = worker replicas × N). Each shard owns a fixed router subset → no duplicate
  polls, easy horizontal scale. Polls: `/system resource print`, `/interface monitor-traffic`,
  `/ip hotspot active print count-only`, `/ppp active` (hub-side count).
- **commands**: single-router config commands from the panel (hotspot user add,
  firewall rule move, queue set…). Idempotent: every command carries a platform
  `opId`; the router's config is reconciled against desired state, not blindly appended.
- **provision**: onboarding token redemption, hub secret create/rotate/delete,
  first-contact bootstrap.
- **backup**: scheduled `/export` + `/system backup save` per router (staggered),
  download via API, encrypt, store.
- **quota-enforcer**: hotspot time/volume quotas; runs on schedule, disables/rate-limits
  over-quota users.

### apps/web (Next.js App Router, TS)
Tailwind + shadcn/ui, next-intl (Arabic RTL default, English), React Query,
Socket.IO live status. Corporate-premium, technician-friendly (big touch targets,
Arabic-first labels).

### infra/ros-scripts
- `onboard.rsc` — generated per onboarding token: creates SSTP client (pointing at
  `SSTP_HUB_HOST`), restricted `panel-api` user + least-privilege group, sets identity,
  installs `watchdog.rsc` + scheduler, performs HTTPS callback to the platform.
- `watchdog.rsc` — runs every 2 min: verifies SSTP client running + API reachable;
  redials (disable/enable sstp-client) on failure; self-heals; logs to `/log` with
  topic `panel-watchdog`.

## 3. Data flows

### 3.1 Onboarding
```
tech gets one-time token in panel
  → panel renders ONE terminal line:
    /tool fetch mode=https address=<panel> src-path=/api/v1/onboard/<token>/onboard.rsc \
      dst-path=onboard.rsc; /import onboard.rsc
  → tech pastes into router terminal (WinBox/SSH, admin)
  → router fetches generated onboard.rsc (token single-use, 15-min TTL)
  → script: 1) /interface sstp-client add connect-to=$SSTP_HUB_HOST port=443
               user=<sstp-user> password=<sstp-pass> profile=default-encryption
               authentication=mschap2 tls-version=only-1.2 disabled=no
            2) /user group add name=panel-api policy=read,write,api,rest-api,test,!sensitive,...
               /user add name=panel-api group=panel-api password=<random>
            3) identity set name=<site-slug> + /system note set note="panel-uuid=<uuid>"
               (identity has no comment property — UUID goes in /system note)
            4) install watchdog scheduler (start-time=startup interval=2m)
            5) HTTPS callback: POST /api/v1/onboard/<token>/callback {uuid, version, board}
  → SSTP dials out; hub /ppp secret already exists (created at token issue time)
  → platform sees PPP active + callback → router status=online, token burned
```

### 3.2 Command path (panel → router)
```
web (React Query mutation) → api POST /routers/:id/hotspot/users {opId, ...}
  → api validates RBAC + writes AuditLog(pending) → BullMQ queue "commands"
  → worker connection-manager picks session for router (or dials API over tunnel)
  → ros-api sends typed sentence, e.g. /ip/hotspot/user/add =name=.. =password=..
  → response !done → AuditLog(done) + Socket.IO push to room router:<id>
  → on !trap → retry per policy / mark failed, alert operator
```

### 3.3 Metrics path
```
poller shard (every 60 s per router, staggered) → API sentences over tunnel:
  /system/resource/print  /interface/monitor-traffic  /ip/hotspot/active/print
  → normalized → TimescaleDB hypertables (cpu/mem/traffic/hotspot-active)
  → connection-manager heartbeat → Router.lastSeen; missed 3× → status=offline,
    downtime ledger row opened (startedAt); reconnect → row closed (endedAt, duration)
```

### 3.4 Backup path
```
BullMQ "backup" (daily, staggered 02:00–05:00 local) →
  /export file=<ts>.rsc ; /system/backup/save name=<ts>.backup
  → /file/print → fetch via API → AES-256-GCM encrypt (KMS key) → object storage
  → Backup row (routerId, type, sizeBytes, sha256, retentionUntil)
  → restore: decrypt → /import (text) or /system/backup/load (binary) + reboot
```

### 3.5 Downstream device proxy
```
platform discovers via /ip/neighbor/print on site router
  → operator "Enable remote access" → platform allocates tunnel-side port P
  → /ip/firewall/nat/add action=dst-nat chain=dstnat dst-address=<tunnelIP>
      protocol=tcp dst-port=<P> to-addresses=<lanIP> to-ports=<mgmtPort>
      comment=panel-proxy:<deviceId>
  → tech SSHes to <tunnelIP>:<P> (routed through hub → site router → LAN)
  → lifecycle managed: rules tagged by comment, garbage-collected on device delete
```

## 4. Scaling plan to 1000+ routers

| Concern | Design |
|---|---|
| API sessions | Connection-manager pool: **one persistent TCP session per router**, multiplexed; per-session command pipeline with backpressure. ~1000 idle TCP sessions is fine for Node; heavy ops go through the `commands` queue with per-router concurrency = 1 (RouterOS API is effectively single-threaded per connection). |
| Polling | Sharded pollers: `shard = hash(router.uuid) mod SHARD_COUNT`. Add worker replicas → rebalance shards on startup via Redis lock. 60 s cadence × 1000 routers ÷ shards = trivial per-shard load. Stagger inside the shard (jitter 0–60 s). |
| Queues | BullMQ queues: `commands`, `provision`, `backup`, `metrics-ingest`, `quota`, `notify`. Redis Cluster when one node saturates. Backups rate-limited (max 20 concurrent, off-hours). |
| Metrics | TimescaleDB hypertables on all metric tables, 1-day chunks, compression after 7 d, retention 90 d (configurable). Continuous aggregates for 1 h / 1 d rollups feeding dashboards. |
| API | Stateless NestJS; scale replicas behind the Dokploy proxy. No in-memory router state anywhere outside `apps/worker`. |
| DB | Prisma + Postgres; read replica for dashboards in Phase 2. Hot paths indexed (see DATA-MODEL.md). |
| Hub CHR | SSTP scales to thousands of sessions on a CHR; size CPU by expected concurrent management traffic (light). Plan: monitor `/ppp active count-only`; scale CHR up or split to a second hub (DNS `SSTP_HUB_HOST` can return multiple A records — but keep single-hub until >2k routers). |

Capacity rule of thumb: 1 worker replica ≈ 250 routers for 60 s polling + command traffic.
Start: 4 replicas → 1000 routers with headroom.

## 5. Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Hub CHR down | Platform can't reach hub; all tunnels drop; connection-manager mass-offline | CHR auto-restart (Dokploy/Proxmox); routers redial automatically (SSTP client `disabled=no` + watchdog). `SSTP_HUB_HOST` DNS can be repointed to a standby CHR whose `/ppp secret` set is synced from platform DB (provisioning module replays secrets). RTO target: < 15 min. |
| Router offline (power/ISP) | missed heartbeats → status=offline, downtime ledger opens | Nothing to do remotely; ledger records duration for SLA. On return: watchdog + SSTP auto-redial → status=online, ledger closes. Queued commands for that router are held (not dropped) with TTL 24 h. |
| Tunnel flap | PPP active flapping; API session drops | Watchdog redials locally; connection-manager backoff reconnect (5 s → 5 min, jitter). Flap counter per router; >10/h → alert (likely ISP issue). |
| API session drop (router reboot) | `!fatal` / socket close | Re-login both flows; session re-established; in-flight command retried once (idempotent by opId). |
| Poller replica crash | BullMQ stalled-job detection; shard heartbeat in Redis | Another replica takes the shard (claim via Redis lock after 2 missed heartbeats). |
| Redis down | Queue errors | BullMQ retries; commands API returns 503 with `Retry-After`; metrics gap is acceptable (hypertable backfill skipped — documented gap). |
| Postgres down | API health check fails | API serves cached last-known status from Redis (5-min TTL) in degraded mode; writes rejected with clear error. |
| Secret rotation | per-router rotation job | Provisioning rotates SSTP password + API password atomically-ish: write new creds to router over existing session first, then update DB/hub secret; old creds kept as fallback for 1 cycle. |
| Rogue/duplicate router identity | same UUID seen from 2 tunnel IPs | Quarantine: new session marked `suspect`, operator must approve; audit-logged. |

## 6. Security model

- **Least-privilege platform API user** on every router:
  `/user group add name=panel-api policy=read,write,api,rest-api,test`
  with explicit denials for `sensitive` (no PSKs/secrets readable), `sniff`, `romon`,
  `reboot`, `policy`, `ftp`, `telnet`, `ssh`, `winbox`, `web`, `password`.
  (Group/user creation syntax verified against community-hardened examples; the exact
  deny-list is enforced again by the platform on every login.)
- **Per-router unique credentials**: SSTP username/password and API password are
  generated per router (32+ chars), stored as references (Vault/KMS) — never plaintext
  in the DB, never in git, never in docs.
- **Network**: management only inside the tunnel; site router input firewall accepts
  API (8728) only from `10.200.0.0/16`; SSTP server input accepts 443 from anywhere
  (clients roam) but authentication is per-router strong secret.
- **Backups encrypted at rest** (AES-256-GCM, KMS-managed key), checksums stored,
  retention enforced by janitor job.
- **Audit log**: every mutating action (who, what, router, before/after, opId) —
  append-only, retained 1 year.
- **Onboarding tokens**: single-use, 15-minute TTL, bound to the issuing operator;
  callback must present the token + router UUID.
- **Panel**: TLS everywhere; RBAC (admin/operator/technician/viewer); technician role
  can onboard + view, cannot change firewall/queues.
