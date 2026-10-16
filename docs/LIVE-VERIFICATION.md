# Live Verification Checklist — MikroTik Fleet Platform

> 🟡 **STATUS: PARTIALLY RUN — first live pass executed 2026-10-16.** Direct
> ros-api verification was run against the real hub CHR (`34.91.70.17`) and test
> CHR (`34.12.242.142`), both RouterOS **6.49.17**, after TCP egress was enabled
> for the build environment. Items proven by **direct ros-api calls** are marked
> `RUN — PASS` / `PARTIAL` below; items that require the **panel → worker →
> router** path remain **NOT YET RUN** — they stay blocked until the Dokploy
> deployment is accepted live (see "Deployment verification (Dokploy)" at the
> end of this document).
>
> **Proven live 2026-10-16 (direct ros-api):** hub SSTP server up on 443 with a
> Let's Encrypt cert (Gen-Y chain: YR2 → Root YR); test client connected with
> `verify-server-certificate=yes` +
> `verify-server-address-from-certificate=yes`; DNS-based dialing via
> `vpn.onetsbyblarch.online` (tunnel re-established, hub→client ping 3/3, 0%
> loss); PPP secret `sstp-test-01` with static tunnel IP `10.200.0.2`; login
> strategy (new-style `/login` first, MD5-challenge fallback; item targeting
> via `=.id=`); hotspot user CRUD; firewall filter add/move/remove; queue
> simple add/set/remove (RouterOS normalizes `20M/20M` → `20000000/20000000` —
> expected behavior, not a failure); system backup create (24,048 bytes) +
> config export + cleanup. The queue proofs have no dedicated checklist item
> below and are recorded here.
>
> Test assets (from project context):
> - Hub CHR (SSTP server): `34.91.70.17` — **custom service ports**: SSH 8922,
>   Telnet 8923, FTP 8921, WWW 8980. API port 8728 (confirmed live 2026-10-16).
> - Test site CHR (SSTP client target): `34.12.242.142` — default ports.
>
> DNS update 2026-10-16: canonical hub address is `vpn.onetsbyblarch.online`
> (Cloudflare; `vpn` repointed to the hub CHR `34.91.70.17`). **CONFIRMED LIVE:**
> `vpn.onetsbyblarch.online` resolves to the hub CHR, the test client was
> switched to `connect-to=vpn.onetsbyblarch.online:443`, the tunnel
> re-established and hub→client ping shows 0% loss — DNS-based SSTP dialing is
> PROVEN. Every item below uses `SSTP_HUB_HOST=vpn.onetsbyblarch.online`
> (underlying hub IP `34.91.70.17` noted for reference only).
>
> ⚠️ Credentials discipline: values are passed via environment variables at runtime
> only (`SSTP_HUB_HOST`, per-router secrets from the vault). Nothing secret is written
> here, in logs, or in git.

Conventions: `<HUB>` = hub CHR tunnel-side or public IP as appropriate;
`<SITE>` = test site CHR; `<TUN>` = site router tunnel IP (10.200.x.y);
commands run from the VPS shell unless marked `[router-terminal]`.

---

## 1. Hub SSTP server verification

**Steps**
```bash
# 1a. API reachability to hub (port from env; default 8728)
# use the ros-api CLI probe (packages/ros-api) or any API client:
/login with =name=<hub-admin-user> =password=<from env HUB_ADMIN_PASS>
/interface/sstp-server/server/print
```
**Expected:** one row, `enabled=true`, `port=443`, `authentication=mschap2`,
`certificate=<name>`, `default-profile=<ppp-profile-panel>`.

```bash
# 1b. PPP secrets for test router exist with static remote-address
/ppp/secret/print where name=<test-sstp-user>
```
**Expected:** `service=sstp`, `profile=<ppp-profile-panel>`,
`remote-address=<TUN>` (static, inside 10.200.0.0/16).

```bash
# 1c. Firewall: 443 open
/ip/firewall/filter/print where dst-port=443
```
**Expected:** `chain=input action=accept protocol=tcp dst-port=443`.

**Mark:** PARTIAL (2026-10-16) — 1a/1b RUN — PASS: SSTP server up on 443
serving the Let's Encrypt cert (Gen-Y: YR2 → Root YR); API login to the hub
works; PPP secret `sstp-test-01` exists with static tunnel IP `10.200.0.2`.
1c (explicit `/ip/firewall/filter/print` for the 443 accept rule) was not
separately captured — successful external SSTP dial-in to 443 is indirect
evidence only.

## 2. Client dial from test CHR

**Steps** `[router-terminal on 34.12.242.142]`
```
/interface sstp-client add name=sstp-hub connect-to=$SSTP_HUB_HOST port=443 \
  user=<test-sstp-user> password=<from env> profile=default-encryption \
  authentication=mschap2 tls-version=only-1.2 verify-server-certificate=no disabled=no
/interface sstp-client print
/ip address print where interface~"sstp"
```
**Expected:** interface shows flag `R` (running); address list shows `<TUN>/32`
(or /16) on the sstp interface. On the hub: `/ppp/active/print` shows the user
with address `<TUN>`.

**Mark:** RUN — PASS (2026-10-16) — test client dials
`vpn.onetsbyblarch.online:443` (DNS-based dialing), tunnel re-established and
running, static tunnel IP `10.200.0.2` assigned, hub→client ping 3/3 with 0%
loss. Note: the live client runs with `verify-server-certificate=yes` +
`verify-server-address-from-certificate=yes` — stronger than the
`verify-server-certificate=no` shown in the step template above.

## 3. API reachability over the tunnel IP

**Steps** (from VPS, through the tunnel — no public-IP management)
```bash
# connect ros-api to <TUN>:<apiPort> (apiPort per-router; default 8728)
/ip/service/print   # confirm api disabled=no, port matches Router.apiPort
/system/resource/print
```
**Expected:** `platform`, `version` (6.x/7.x), `board-name`, `uptime` returned;
round-trip < 300 ms typical.

**Mark:** PARTIAL (2026-10-16) — ros-api against the test CHR is proven (the
direct proofs in items 4/6/7/9 all ran over it) and the tunnel itself is proven
(PPP active; hub→client ping 0% loss). NOT YET RUN: ros-api addressed to the
tunnel IP `10.200.0.2` from the platform host — the 2026-10-16 direct calls
targeted the CHR's public address, and the platform stack is not yet accepted
live (see Deployment verification).

## 4. ros-api login — BOTH flows

**Steps**
```bash
# 4a. Modern flow (6.43+/v7 test CHR): single /login =name= =password=
# 4b. Legacy flow: force against a pre-6.43 device or a mock: /login → =ret=<challenge>
#     → /login =name= =response=00<md5(0x00+password+challenge)>
# 4c. Wrong password → expect clean typed AuthError, no hang, no crash
```
**Expected:** 4a and 4b succeed and return `!done`; 4c raises `RosApiAuthError`
within the login timeout. (Unit tests cover the byte-level encoding; this item
proves it against real RouterOS.)

**Mark:** PARTIAL (2026-10-16) — 4a RUN — PASS live on 6.49.17 (new-style
`/login` with `=name=`/`=password=` sent first; a bare `/login` first fails on
6.43+, as expected). 4b: the MD5-challenge fallback is implemented in ros-api
and covered by unit tests against the mock RouterOS server, but has NOT been
proven against a real pre-6.43 device — none exists in the lab (both CHRs run
6.49.17). 4c (wrong password → clean typed `RosApiAuthError`) was not
separately evidenced in the live run.

## 5. Onboarding one-liner end-to-end

**Steps**
1. Panel → issue onboarding token for a lab site (15-min TTL).
2. `[router-terminal on a fresh CHR]` paste the single line:
   ```
   /tool fetch mode=https address=<panel-host> src-path=/api/v1/onboard/<token>/onboard.rsc dst-path=onboard.rsc; /import onboard.rsc
   ```
3. Observe: SSTP client created, `panel-api` user created, identity set,
   watchdog scheduler installed, callback fired.
4. Panel → Routers: new row appears, status `online`, UUID matches.

**Expected:** total time paste→online < 90 s; token burned (reuse returns 410);
`/user/print where name=panel-api` exists; `/system/scheduler/print` shows the
watchdog (interval 2m, start-time=startup).

**Mark:** NOT YET RUN ☐ — blocked on the panel being live (see Deployment
verification). The underlying pieces (hub PPP secret, SSTP client with LE
certificate verification) were proven manually by script on 2026-10-16, but
the token → one-liner → panel flow itself has never been executed.

## 6. Hotspot user CRUD round-trip

**Steps** (all via panel → worker → ros-api → `<TUN>`)
1. Create hotspot server-profile + user-profile (rate-limit 5M/10M) + user
   `test-guest-01`.
2. Verify on router: `/ip/hotspot/user/print where name=test-guest-01`
3. Disable user from panel → verify `disabled=yes` on router.
4. Delete user from panel → verify gone from router.
5. Check AuditLog has 3 `done` rows with matching opIds.

**Expected:** each step reflected on the router ≤ 10 s; audit rows complete.

**Mark:** PARTIAL (2026-10-16) — create/read/delete of hotspot users
RUN — PASS via direct ros-api calls against the test CHR. NOT YET RUN: the
steps as written (panel → worker → router), disable-from-panel, and the
AuditLog rows (step 5).

## 7. Firewall rule add/remove (+ safe-apply)

**Steps**
1. Panel → add filter rule `chain=input action=drop protocol=tcp dst-port=9999
   comment=panel-verify` → verify on router via `/ip/firewall/filter/print`.
2. Move it to position 0 via panel → verify order changed.
3. Delete via panel → verify gone.
4. **Safe-apply drill:** push a deliberately bad rule (drops API from tunnel);
   worker must detect lost heartbeat within 60 s and auto-revert.

**Expected:** add/move/delete all reconcile; safe-apply reverts and raises an alert.

**Mark:** PARTIAL (2026-10-16) — steps 1–3 RUN — PASS via direct ros-api
calls against the test CHR: filter rule ADD, MOVE (reorder), and REMOVE all
verified on the router. NOT YET RUN: the same operations driven from the
panel, and the step-4 safe-apply rollback drill (push a rule that blocks
management and watch auto-revert).

## 8. Downtime ledger on forced disconnect

**Steps**
1. Note time T0. `[router-terminal]` `/interface sstp-client disable [find name=sstp-hub]`
2. Wait 4 min → panel shows router `offline`; `Downtime` row opened with
   `startedAt ≈ T0`.
3. Re-enable the client; wait for reconnect.
4. Check the `Downtime` row: `endedAt` set, `durationS` ≈ actual offline seconds ±60.

**Expected:** ledger matches the forced window; no duplicate rows on flap
(single disable/enable = exactly one row).

**Mark:** NOT YET RUN ☐ — depends on the worker poller + monitoring
persistence, which are not yet live (see Deployment verification). Tunnel
state changes were observed manually during the 2026-10-16 session, but no
Downtime ledger rows have ever been produced.

## 9. Backup / restore smoke test

**Steps**
1. Panel → trigger manual backup (type: both).
2. Verify `Backup` row: sizeBytes > 0, sha256 present, storage object exists and
   decrypts (verify checksum post-decrypt).
3. **Lab only:** reset test CHR (`/system/reset-configuration`), re-onboard,
   then panel → Restore latest backup.
4. Verify hotspot user + firewall rule from item 6/7 era are back
   (restore the *backup's* contents, not the live state).

**Expected:** restore completes; router returns to managed `online` state;
config matches the backup snapshot.

**Mark:** PARTIAL (2026-10-16) — the router-side half of step 1 RUN — PASS
via direct ros-api: `/system backup save` created a 24,048-byte backup on
the test CHR and `/export` produced a config export; the test files were
cleaned up afterwards. NOT YET RUN: panel-triggered backup with encrypted
storage + post-decrypt checksum verification (step 2), and the
factory-reset → re-onboard → restore drill (steps 3–4).

## 10. Watchdog self-heal

**Steps**
1. `[router-terminal]` kill the SSTP client abnormally:
   `/interface sstp-client disable [find name=sstp-hub]` (watchdog must NOT be disabled).
2. Watch `/log/print where topics~"panel-watchdog"` for ≤ 6 min.

**Expected:** watchdog detects the down tunnel and re-enables the client on its own;
log shows detect → redial → connected. Panel downtime row for this episode is
short (< 5 min) or absent if redial beat the 3-missed-heartbeat threshold.

**Mark:** NOT YET RUN ☐ — the watchdog script ships in the onboarding
template, but this kill-and-watch drill has never been executed on a live
router.

---

## Sign-off

| Item | Result | Date | By |
|---|---|---|---|
| 1 Hub SSTP | 🟡 PARTIAL (1c not separately captured) | 2026-10-16 | |
| 2 Client dial | ✅ PASS | 2026-10-16 | |
| 3 API over tunnel | 🟡 PARTIAL (tunnel-IP path not run) | 2026-10-16 | |
| 4 Login both flows | 🟡 PARTIAL (4b mock-only, 4c open) | 2026-10-16 | |
| 5 Onboarding 1-liner | ☐ NOT YET RUN | | |
| 6 Hotspot CRUD | 🟡 PARTIAL (direct ros-api only) | 2026-10-16 | |
| 7 Firewall + safe-apply | 🟡 PARTIAL (direct ros-api only) | 2026-10-16 | |
| 8 Downtime ledger | ☐ NOT YET RUN | | |
| 9 Backup/restore | 🟡 PARTIAL (create/export only) | 2026-10-16 | |
| 10 Watchdog self-heal | ☐ NOT YET RUN | | |
| 11 Deployment (Dokploy) | ⛔ BLOCKED (both crash causes fixed + locally proven 2026-10-16; vault decision + redeploy pending — see below) | 2026-10-16 | |

No item may be marked done without pasted command output as evidence.

---

## Local stack verification — 2026-10-16

> 🖥️ **LOCAL ONLY — this is NOT production evidence.** The full stack was
> run as local processes against apt-installed PostgreSQL 16 +
> TimescaleDB and Redis (Docker image pulls were unavailable in the
> build sandbox). Nothing here marks any panel-path checklist item
> above as run; it proves the code and the deployment fixes before
> they ship.

- **Migrations:** all 3 migrations applied cleanly via a real
  `prisma migrate deploy` on a fresh TimescaleDB — 25 tables,
  4 hypertables, the `metric_traffic_1h` continuous aggregate,
  6 background jobs. Production root cause found: `0002_timescale`
  created its continuous aggregate `WITH DATA`, which cannot run
  inside Prisma's per-migration transaction (P3018 on apply → the
  migration is recorded failed → P3009 on every later deploy). Fixed
  by creating the aggregate `WITH NO DATA`. The exact production
  state was then simulated locally and the recovery
  (`migrate resolve --rolled-back 0002_timescale` + deploy of the
  fixed migration) was proven end-to-end; the api entrypoint now has
  an env-gated one-shot resolve fallback (`PRISMA_RESOLVE_ROLLED_BACK`,
  default-off).
- **API:** boots; `GET /health` → 200.
- **Internal contract:** `GET /internal/worker/routers` → 401 without
  a key and with a wrong key; `{"routerIds":[]}` with the correct
  key; an unknown router's endpoint → 404 (the worker maps it to
  `UnknownRouterError`).
- **Worker:** boots against the api and polls; when the api was
  killed mid-run the worker logged the `ECONNREFUSED` and kept
  cycling — **no crash** (the exact failure that crash-looped the
  production worker) — and recovered silently when the api returned.
- **Web:** the standalone build serves `/en` with 200.

---

## Deployment verification (Dokploy) — 2026-10-16

- The Compose stack (TimescaleDB `postgres`, `redis`, `api`, `worker`, `web`)
  builds and deploys on Dokploy from `infra/dokploy/compose.yml`. Domains
  `admin.onetsbyblarch.online` → `web:3000` and
  `api.onetsbyblarch.online` → `api:3001` are configured, with Traefik
  routing + Let's Encrypt certificate labels in place and both services
  joined to `dokploy-network`.
- ⛔ **BLOCKED — the platform is NOT yet accepted live (production has
  not been redeployed).** Both original crash causes were root-caused,
  fixed in the working copy, and proven on a local stack on 2026-10-16
  (see "Local stack verification" above): the `0002_timescale`
  migration failure (continuous aggregate created `WITH DATA` inside
  Prisma's per-migration transaction → P3018, recorded failed, then
  P3009 on every deploy) and the worker crash-loop (missing
  `/internal/worker/*` endpoints + auth mismatch + unhandled
  rejection). The remaining blocker chain, in order: (1) **the vault
  is in-memory only** — no persistent `VaultPort` implementation
  exists, so router passwords would be lost on any api restart; a
  persistent implementation must land first (decision pending with
  the owner: AES-256-GCM encrypted Postgres vault vs a HashiCorp
  Vault service); (2) the deploy batch — compose env fixes
  (`PANEL_PUBLIC_HOST` missing from the api env, a `getOrThrow` that
  would crash the api at boot; CORS name mismatch: the code reads
  `CORS_ORIGINS`, the compose sets `CORS_ORIGIN`), push, Dokploy env
  (incl. `INTERNAL_API_KEY` and the one-shot
  `PRISMA_RESOLVE_ROLLED_BACK` for the failed-migration record), a
  single redeploy, and domain verification.
- Until the redeploy lands healthy, every panel-path
  item above (5, the panel halves of 6/7/9, 8, and item 10's panel-side
  assertions) remains blocked, and the 7-day soak on ≥3 routers cannot
  start.
