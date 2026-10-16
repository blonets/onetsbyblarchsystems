# RouterOS device scripts (`.rsc`)

Device-side RouterOS scripts, every command verified against the official
MikroTik documentation (manual.mikrotik.com / help.mikrotik.com, 2026-10-16):

| File | Purpose |
|---|---|
| `sstp-hub-setup.rsc` | Hub CHR: SSTP server on TCP 443 (self-signed CA + server cert, TLS 1.2-only, mschap2), tunnel PPP profile, input-443 firewall rule, `/ppp secret` template with static `remote-address` |
| `sstp-client-template.rsc` | Site router: SSTP client dial-out to `SSTP_HUB_HOST:443`, keepalive 60, UUID in comment |
| `onboard.rsc` | One-paste onboarding: identity + UUID (`/system note` — identity has no `comment` property), least-privilege API group/user, API service locked to `10.200.0.0/16`, SSTP client, inlined watchdog + 30s scheduler, HTTPS callback via `/tool fetch` |
| `watchdog.rsc` | Standalone watchdog: redials SSTP if not `running`, logs if the platform API user is missing (deliberately NOT recreated — the password is platform-held) |

All credential slots are `:local` variables / `# CHANGE:` markers — no secrets in
these scripts. Variables each operator must set are marked at the top of every
file.
