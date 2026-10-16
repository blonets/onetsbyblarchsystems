# Live Verification Checklist — MikroTik Fleet Platform

> ⛔ **STATUS: NOT YET RUN.** Every item below is deferred until TCP egress is enabled
> for the build environment **or** until this checklist is executed post-deploy on the
> Dokploy VPS (which has full network access to the hub CHR and the test site CHR).
>
> Test assets (from project context):
> - Hub CHR (SSTP server): `34.91.70.17` — **custom service ports**: SSH 8922,
>   Telnet 8923, FTP 8921, WWW 8980. API port assumed default 8728 (confirm in item 1).
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

**Mark:** NOT YET RUN ☐

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

**Mark:** NOT YET RUN ☐

## 3. API reachability over the tunnel IP

**Steps** (from VPS, through the tunnel — no public-IP management)
```bash
# connect ros-api to <TUN>:<apiPort> (apiPort per-router; default 8728)
/ip/service/print   # confirm api disabled=no, port matches Router.apiPort
/system/resource/print
```
**Expected:** `platform`, `version` (6.x/7.x), `board-name`, `uptime` returned;
round-trip < 300 ms typical.

**Mark:** NOT YET RUN ☐

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

**Mark:** NOT YET RUN ☐

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

**Mark:** NOT YET RUN ☐

## 6. Hotspot user CRUD round-trip

**Steps** (all via panel → worker → ros-api → `<TUN>`)
1. Create hotspot server-profile + user-profile (rate-limit 5M/10M) + user
   `test-guest-01`.
2. Verify on router: `/ip/hotspot/user/print where name=test-guest-01`
3. Disable user from panel → verify `disabled=yes` on router.
4. Delete user from panel → verify gone from router.
5. Check AuditLog has 3 `done` rows with matching opIds.

**Expected:** each step reflected on the router ≤ 10 s; audit rows complete.

**Mark:** NOT YET RUN ☐

## 7. Firewall rule add/remove (+ safe-apply)

**Steps**
1. Panel → add filter rule `chain=input action=drop protocol=tcp dst-port=9999
   comment=panel-verify` → verify on router via `/ip/firewall/filter/print`.
2. Move it to position 0 via panel → verify order changed.
3. Delete via panel → verify gone.
4. **Safe-apply drill:** push a deliberately bad rule (drops API from tunnel);
   worker must detect lost heartbeat within 60 s and auto-revert.

**Expected:** add/move/delete all reconcile; safe-apply reverts and raises an alert.

**Mark:** NOT YET RUN ☐

## 8. Downtime ledger on forced disconnect

**Steps**
1. Note time T0. `[router-terminal]` `/interface sstp-client disable [find name=sstp-hub]`
2. Wait 4 min → panel shows router `offline`; `Downtime` row opened with
   `startedAt ≈ T0`.
3. Re-enable the client; wait for reconnect.
4. Check the `Downtime` row: `endedAt` set, `durationS` ≈ actual offline seconds ±60.

**Expected:** ledger matches the forced window; no duplicate rows on flap
(single disable/enable = exactly one row).

**Mark:** NOT YET RUN ☐

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

**Mark:** NOT YET RUN ☐

## 10. Watchdog self-heal

**Steps**
1. `[router-terminal]` kill the SSTP client abnormally:
   `/interface sstp-client disable [find name=sstp-hub]` (watchdog must NOT be disabled).
2. Watch `/log/print where topics~"panel-watchdog"` for ≤ 6 min.

**Expected:** watchdog detects the down tunnel and re-enables the client on its own;
log shows detect → redial → connected. Panel downtime row for this episode is
short (< 5 min) or absent if redial beat the 3-missed-heartbeat threshold.

**Mark:** NOT YET RUN ☐

---

## Sign-off

| Item | Result | Date | By |
|---|---|---|---|
| 1 Hub SSTP | ☐ NOT YET RUN | | |
| 2 Client dial | ☐ NOT YET RUN | | |
| 3 API over tunnel | ☐ NOT YET RUN | | |
| 4 Login both flows | ☐ NOT YET RUN | | |
| 5 Onboarding 1-liner | ☐ NOT YET RUN | | |
| 6 Hotspot CRUD | ☐ NOT YET RUN | | |
| 7 Firewall + safe-apply | ☐ NOT YET RUN | | |
| 8 Downtime ledger | ☐ NOT YET RUN | | |
| 9 Backup/restore | ☐ NOT YET RUN | | |
| 10 Watchdog self-heal | ☐ NOT YET RUN | | |

No item may be marked done without pasted command output as evidence.
