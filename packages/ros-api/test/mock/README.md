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

Emulated surface: `/system/resource/print`, `/system/identity/print`,
`/queue/simple/print`, `/ip/hotspot/user/{print,add,remove,set}`,
`/ip/firewall/filter/{print,add,remove}`, `=.tag=` echo, `?k=v` print filters.
Everything else → `!trap =message=unknown command`.

Scope warning: this proves protocol correctness only. It is not a RouterOS
device — do not present mock results as live-device verification.
