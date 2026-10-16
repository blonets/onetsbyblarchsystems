# mock-routeros — local RouterOS API protocol mock

A plain-Node (no dependencies) TCP server that speaks the RouterOS API binary
word protocol well enough to validate a client implementation on localhost.

- `server.mjs` — the mock. `node server.mjs --help` for options
  (`--port`, `--login legacy|modern|both`, `--user`, `--password`,
  `--ros-version`, `--board`). Prints `READY port=<n> …` when listening.
  Binds `127.0.0.1` only.
- `selftest.mjs` — independent reference client (spec-written, shares no code
  with the server) that spawns the mock in `legacy`, `modern`, and `both`
  modes and runs the full round-trip battery. Exit `0` = faithful.

```
node selftest.mjs
```

Protocol notes (per MikroTik Manual:API): words are length-prefixed
(1–4 byte encode here; 1–5 byte decode), sentences end with a zero-length word,
replies are `!re` / `!done` / `!trap` / `!fatal`. Pre-6.43 login is the
`/login` → `=ret=<32-hex>` → `=response=00md5(0x00 ‖ password ‖ challenge)`
challenge-response; 6.43+/v7 is `/login` with `=name=` + `=password=`.

Emulated surface: generic in-memory CRUD (print/add/set/remove/enable/disable,
plus move for ordered lists) for
`/ip/hotspot`, `/ip/hotspot/profile`, `/ip/hotspot/user`,
`/ip/hotspot/user/profile`, `/ip/hotspot/walled-garden`,
`/ip/hotspot/walled-garden/ip`, `/ip/firewall/filter|nat|mangle`,
`/ip/firewall/address-list`, `/queue/simple|tree`, `/ppp/secret`,
`/ppp/profile`, `/ppp/active`, `/system/scheduler`, `/system/script`,
`/system/note`, `/system/identity`, `/ip/address`, `/ip/dhcp-server`,
`/ip/dhcp-server/network`, `/ip/pool`, `/interface/sstp-client`, `/interface`;
fixed rows for `/system/resource/print`, `/system/routerboard/print`,
`/system/package/print`, `/ip/neighbor/print` (2 seeded neighbors),
`/system/backup/save`, `/export` (raw config lines).
Device-faithful quirks: `/interface/sstp-client/add` accepts ONLY
connect-to/user/password (else `!trap`; the builder stays on this
conservative path even though the real 6.49.17 device also tolerates
name/disabled/verify-server-certificate at creation); `=port=` is not a valid
sstp-client parameter at all — `!trap` on add and set (the port travels inside
connect-to as `host:port`, live-verified on 6.49.17);
`/system/identity/set` rejects `=comment=` with `!trap`; bare `/login` is
rejected in `--login modern` mode.
`=.tag=` echo, `?k=v` print filters, `=numbers=`/`=.id=` targeting,
`=ret=<id>` on add. Protocol-faithful `!trap` handling: every `!trap` is
followed by the final `!done` (live-verified on RouterOS 6.49.17); `remove`
with no id is a silent no-op `!done`. Everything else →
`trap =message=unknown command` (+ trailing `!done`).

Scope warning: this proves protocol correctness only. It is not a RouterOS
device — do not present mock results as live-device verification.
