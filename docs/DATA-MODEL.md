# Data Model — MikroTik Fleet Management Platform

Prisma-style schema. Conventions: `id` = cuid UUID string PK; all timestamps UTC;
soft-delete via `deletedAt` where noted. **Credential rule: the DB stores only
references** (`sstpPasswordRef`, `apiPasswordRef` → Vault/KMS key id) — never plaintext.

```prisma
// ---------- Identity & access ----------

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String   // argon2
  role         Role     @relation(fields: [roleId], references: [id])
  roleId       String
  sites        SiteUser[]
  auditLogs    AuditLog[]
  tokensIssued OnboardingToken[]
  createdAt    DateTime @default(now())
  disabledAt   DateTime?
  @@index([roleId])
}

model Role {
  id          String @id @default(cuid())
  name        String @unique // admin | operator | technician | viewer
  description String?
  users       User[]
  // Permissions are code-level (RBAC guard), not per-row. Technician: onboard+view;
  // operator: + hotspot/firewall/queues; admin: + users, secrets rotation, restore.
}

model SiteUser {
  userId String
  siteId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  site   Site @relation(fields: [siteId], references: [id], onDelete: Cascade)
  @@id([userId, siteId])
}

// ---------- Fleet ----------

model Site {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  address   String?
  city      String?
  country   String   @default("EG")
  lat       Float?
  lng       Float?
  notes     String?
  routers   Router[]
  users     SiteUser[]
  createdAt DateTime @default(now())
  deletedAt DateTime?
  @@index([slug])
}

model Router {
  id               String       @id @default(cuid())
  uuid             String       @unique // stamped into the router; identity anchor
  site             Site?        @relation(fields: [siteId], references: [id])
  siteId           String?

  // --- tunnel identity ---
  tunnelIp         String       @unique // 10.200.x.y, static via /ppp secret remote-address
  sstpUsername     String       @unique // per-router unique
  sstpPasswordRef  String       // Vault/KMS reference ONLY, never plaintext
  apiUsername      String       @default("panel-api")
  apiPasswordRef   String       // Vault/KMS reference ONLY

  // --- service ports (per-router configurable; field routers use custom ports,
  //     e.g. hub CHR: ssh 8922 / telnet 8923 / ftp 8921 / www 8980) ---
  apiPort          Int          @default(8728)
  apiSslPort       Int          @default(8729)
  winboxPort       Int          @default(8291)
  sshPort          Int          @default(22)
  wwwPort          Int          @default(80)

  // --- state ---
  status           RouterStatus @default(pending) // pending|online|offline|suspect|decommissioned
  lastSeen         DateTime?
  routerOsVersion  String?      // e.g. "7.15.2"
  boardName        String?      // e.g. "hAP ac^2"
  serialNumber     String?
  identityName     String?      // /system identity name (site slug)
  flapCount        Int          @default(0) // tunnel flaps in last hour (worker-maintained)

  downtimes        Downtime[]
  hotspotServers   HotspotServer[]
  firewallRules    FirewallRule[]
  queues           Queue[]
  backups          Backup[]
  downstream       DownstreamDevice[]
  auditLogs        AuditLog[]
  pollerShard      Int          // hash(uuid) % shards; assigned by worker

  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  decommissionedAt DateTime?

  @@index([status])
  @@index([siteId])
  @@index([pollerShard])
  @@index([lastSeen])
}

enum RouterStatus {
  pending
  online
  offline
  suspect
  decommissioned
}

/// Downtime ledger: one row per offline episode.
model Downtime {
  id        String    @id @default(cuid())
  router    Router    @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId  String
  startedAt DateTime  @default(now())
  endedAt   DateTime?
  durationS Int?      // set on close
  cause     String?   // heartbeat-missed | tunnel-flap | maintenance
  @@index([routerId, startedAt])
}

// ---------- Hotspot v1 ----------

model HotspotServer {
  id          String  @id @default(cuid())
  router      Router  @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId    String
  name        String  // RouterOS-side name
  interface   String
  addressPool String?
  profile     String  // server-profile name
  disabled    Boolean @default(false)
  mikrotikId  String? // *ID from /ip/hotspot/print (for reconciliation)
  @@unique([routerId, name])
  @@index([routerId])
}

model HotspotProfile { // server-profile
  id           String  @id @default(cuid())
  router       Router  @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId     String
  name         String
  hotspotAddress String?
  dnsName      String?
  loginBy      String? // http-pap,http-chap,cookie,...
  rateLimit    String?
  mikrotikId   String?
  @@unique([routerId, name])
}

model HotspotUserProfile { // user-profile (plan)
  id          String  @id @default(cuid())
  router      Router  @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId    String
  name        String
  rateLimit   String? // e.g. "5M/10M"
  sharedUsers Int?
  sessionTimeout String?
  idleTimeout String?
  keepaliveTimeout String?
  quotaBytes  BigInt? // enforced by quota-enforcer (null = unlimited)
  quotaSeconds Int?
  mikrotikId  String?
  @@unique([routerId, name])
}

model HotspotUser {
  id          String   @id @default(cuid())
  router      Router   @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId    String
  name        String
  passwordRef String?  // Vault/KMS reference; null for MAC-cookie users
  profile     HotspotUserProfile? @relation(fields: [profileId], references: [id])
  profileId   String?
  disabled    Boolean  @default(false)
  uptimeUsedS BigInt   @default(0) // reconciled from /ip/hotspot/user
  bytesIn     BigInt   @default(0)
  bytesOut    BigInt   @default(0)
  expiresAt   DateTime?
  comment     String?
  mikrotikId  String?
  createdAt   DateTime @default(now())
  @@unique([routerId, name])
  @@index([routerId, disabled])
}

// ---------- Firewall ----------

model FirewallRule {
  id        String   @id @default(cuid())
  router    Router   @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId  String
  table     String   // filter | nat | mangle
  chain     String   // input | forward | dstnat | srcnat | prerouting ...
  action    String   // accept | drop | dst-nat | masquerade ...
  order     Int      // platform-side ordering; reconciled via place-before
  // match fields (nullable; only set ones are sent)
  protocol  String?
  srcAddress String?
  dstAddress String?
  srcPort   String?
  dstPort   String?
  inInterface String?
  outInterface String?
  toAddresses String?
  toPorts   String?
  comment   String?  // panel-managed rules use comment prefixes, e.g. panel-proxy:
  disabled  Boolean  @default(false)
  managed   Boolean  @default(true) // false = discovered, read-only in UI
  mikrotikId String?
  @@index([routerId, table, chain, order])
}

// ---------- Queues ----------

model Queue {
  id        String  @id @default(cuid())
  router    Router  @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId  String
  kind      String  // simple | tree
  name      String
  target    String? // simple: target address/interface
  parent    String? // tree: parent queue
  maxLimit  String? // "5M/10M"
  limitAt   String?
  priority  Int?
  disabled  Boolean @default(false)
  mikrotikId String?
  @@unique([routerId, kind, name])
}

// ---------- Backups ----------

model Backup {
  id           String   @id @default(cuid())
  router       Router   @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId     String
  type         String   // export | binary
  fileName     String
  storageKey   String   // object-storage key (encrypted blob)
  sizeBytes    BigInt
  sha256       String
  kmsKeyId     String
  retentionUntil DateTime
  createdAt    DateTime @default(now())
  @@index([routerId, createdAt])
}

// ---------- Downstream devices ----------

model DownstreamDevice {
  id           String   @id @default(cuid())
  router       Router   @relation(fields: [routerId], references: [id], onDelete: Cascade)
  routerId     String
  deviceId     String   // used in comment panel-proxy:<deviceId>
  name         String
  kind         String   // mikrotik | ap | camera | pos | switch | other
  macAddress   String?
  lanIp        String
  mgmtPort     Int      // 22 | 80 | 443 | 8728 | 8291
  protocol     String   @default("tcp")
  proxyPort    Int?     // allocated tunnel-side port on the site router
  managedRouterId String? // if kind=mikrotik and registered → Router.id (cascade)
  lastSeen     DateTime?
  @@unique([routerId, deviceId])
  @@index([routerId])
}

// ---------- Provisioning ----------

model OnboardingToken {
  id         String   @id @default(cuid())
  token      String   @unique // single-use
  issuedBy   User     @relation(fields: [issuedById], references: [id])
  issuedById String
  siteId     String?  // pre-assigned site
  sstpUsername String @unique
  tunnelIp   String   @unique
  expiresAt  DateTime // now + 15 min
  usedAt     DateTime?
  router     Router?  // set on successful callback
  @@index([expiresAt])
}

// ---------- Audit ----------

model AuditLog {
  id        String   @id @default(cuid())
  actor     User?    @relation(fields: [actorId], references: [id])
  actorId   String?
  router    Router?  @relation(fields: [routerId], references: [id], onDelete: SetNull)
  routerId  String?
  action    String   // hotspot.user.create | firewall.rule.move | backup.restore ...
  opId      String   @unique // idempotency key from the command path
  before    Json?
  after     Json?
  result    String   // pending | done | failed
  error     String?
  createdAt DateTime @default(now())
  @@index([routerId, createdAt])
  @@index([actorId, createdAt])
}
```

## TimescaleDB metric hypertables

Raw SQL in a Prisma migration (Prisma doesn't manage hypertables natively):

```sql
CREATE TABLE metric_cpu (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  cpu_pct   DOUBLE PRECISION NOT NULL
);
SELECT create_hypertable('metric_cpu', 'ts', chunk_time_interval => INTERVAL '1 day');

CREATE TABLE metric_mem (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  total_kb  BIGINT NOT NULL,
  free_kb   BIGINT NOT NULL
);
SELECT create_hypertable('metric_mem', 'ts', chunk_time_interval => INTERVAL '1 day');

CREATE TABLE metric_traffic (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  iface     TEXT        NOT NULL,
  rx_bps    BIGINT NOT NULL,
  tx_bps    BIGINT NOT NULL
);
SELECT create_hypertable('metric_traffic', 'ts', chunk_time_interval => INTERVAL '1 day');

CREATE TABLE metric_hotspot_active (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  active_n  INTEGER NOT NULL
);
SELECT create_hypertable('metric_hotspot_active', 'ts', chunk_time_interval => INTERVAL '1 day');

-- retention + compression (tune per deployment)
SELECT add_retention_policy('metric_cpu',            INTERVAL '90 days');
SELECT add_retention_policy('metric_mem',            INTERVAL '90 days');
SELECT add_retention_policy('metric_traffic',        INTERVAL '90 days');
SELECT add_retention_policy('metric_hotspot_active', INTERVAL '90 days');
ALTER TABLE metric_traffic SET (timescaledb.compress,
  timescaledb.compress_segmentby = 'router_id,iface',
  timescaledb.compress_orderby = 'ts DESC');
SELECT add_compression_policy('metric_traffic', INTERVAL '7 days');

-- 1-hour rollups for dashboards
CREATE MATERIALIZED VIEW metric_traffic_1h
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', ts) AS bucket, router_id, iface,
       avg(rx_bps)::bigint AS rx_bps, avg(tx_bps)::bigint AS tx_bps
FROM metric_traffic GROUP BY bucket, router_id, iface;
SELECT add_continuous_aggregate_policy('metric_traffic_1h',
  start_offset => INTERVAL '3 hours', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');
```

Notes:
- Metric rows are **write-mostly**; the poller uses `COPY`-style batch inserts
  (Prisma `createMany`, 500-row batches).
- `router_id` is TEXT (not FK) in hypertables — hypertables + FKs to a non-hypertable
  don't mix well; join in app code.
- Downtime ledger stays a normal table (low volume, needs FK + updates).
- Credential columns (`*Ref`) are TEXT key-ids into Vault/KMS; the secret values
  never touch Postgres, logs, or backups of the DB.
