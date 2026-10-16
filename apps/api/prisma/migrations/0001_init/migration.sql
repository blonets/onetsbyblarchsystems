-- CreateEnum
CREATE TYPE "RouterStatus" AS ENUM ('pending', 'online', 'offline', 'suspect', 'decommissioned');

-- CreateTable: roles
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateTable: users
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateTable: sites
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'EG',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");
CREATE INDEX "Site_slug_idx" ON "Site"("slug");

-- CreateTable: site users (m2m)
CREATE TABLE "SiteUser" (
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    CONSTRAINT "SiteUser_pkey" PRIMARY KEY ("userId", "siteId")
);

-- CreateTable: refresh tokens
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateTable: routers
CREATE TABLE "Router" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "siteId" TEXT,
    "tunnelIp" TEXT NOT NULL,
    "sstpUsername" TEXT NOT NULL,
    "sstpPasswordRef" TEXT NOT NULL,
    "apiUsername" TEXT NOT NULL DEFAULT 'panel-api',
    "apiPasswordRef" TEXT NOT NULL,
    "apiPort" INTEGER NOT NULL DEFAULT 8728,
    "apiSslPort" INTEGER NOT NULL DEFAULT 8729,
    "winboxPort" INTEGER NOT NULL DEFAULT 8291,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "telnetPort" INTEGER NOT NULL DEFAULT 23,
    "ftpPort" INTEGER NOT NULL DEFAULT 21,
    "wwwPort" INTEGER NOT NULL DEFAULT 80,
    "status" "RouterStatus" NOT NULL DEFAULT 'pending',
    "lastSeen" TIMESTAMPTZ(3),
    "routerOsVersion" TEXT,
    "boardName" TEXT,
    "serialNumber" TEXT,
    "identityName" TEXT,
    "flapCount" INTEGER NOT NULL DEFAULT 0,
    "pollerShard" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "decommissionedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Router_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Router_uuid_key" ON "Router"("uuid");
CREATE UNIQUE INDEX "Router_tunnelIp_key" ON "Router"("tunnelIp");
CREATE UNIQUE INDEX "Router_sstpUsername_key" ON "Router"("sstpUsername");
CREATE INDEX "Router_status_idx" ON "Router"("status");
CREATE INDEX "Router_siteId_idx" ON "Router"("siteId");
CREATE INDEX "Router_pollerShard_idx" ON "Router"("pollerShard");
CREATE INDEX "Router_lastSeen_idx" ON "Router"("lastSeen");

-- CreateTable: downtime ledger
CREATE TABLE "Downtime" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "durationS" INTEGER,
    "cause" TEXT,
    CONSTRAINT "Downtime_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Downtime_routerId_startedAt_idx" ON "Downtime"("routerId", "startedAt");

-- CreateTable: hotspot servers
CREATE TABLE "HotspotServer" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interface" TEXT NOT NULL,
    "addressPool" TEXT,
    "profile" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "mikrotikId" TEXT,
    CONSTRAINT "HotspotServer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HotspotServer_routerId_name_key" ON "HotspotServer"("routerId", "name");
CREATE INDEX "HotspotServer_routerId_idx" ON "HotspotServer"("routerId");

-- CreateTable: hotspot server-profiles
CREATE TABLE "HotspotProfile" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hotspotAddress" TEXT,
    "dnsName" TEXT,
    "loginBy" TEXT,
    "rateLimit" TEXT,
    "mikrotikId" TEXT,
    CONSTRAINT "HotspotProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HotspotProfile_routerId_name_key" ON "HotspotProfile"("routerId", "name");
CREATE INDEX "HotspotProfile_routerId_idx" ON "HotspotProfile"("routerId");

-- CreateTable: hotspot user-profiles (plans)
CREATE TABLE "HotspotUserProfile" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rateLimit" TEXT,
    "sharedUsers" INTEGER,
    "sessionTimeout" TEXT,
    "idleTimeout" TEXT,
    "keepaliveTimeout" TEXT,
    "quotaBytes" BIGINT,
    "quotaSeconds" INTEGER,
    "mikrotikId" TEXT,
    CONSTRAINT "HotspotUserProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HotspotUserProfile_routerId_name_key" ON "HotspotUserProfile"("routerId", "name");
CREATE INDEX "HotspotUserProfile_routerId_idx" ON "HotspotUserProfile"("routerId");

-- CreateTable: hotspot users
CREATE TABLE "HotspotUser" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordRef" TEXT,
    "profileId" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "uptimeUsedS" BIGINT NOT NULL DEFAULT 0,
    "bytesIn" BIGINT NOT NULL DEFAULT 0,
    "bytesOut" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3),
    "comment" TEXT,
    "mikrotikId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HotspotUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HotspotUser_routerId_name_key" ON "HotspotUser"("routerId", "name");
CREATE INDEX "HotspotUser_routerId_idx" ON "HotspotUser"("routerId");
CREATE INDEX "HotspotUser_routerId_disabled_idx" ON "HotspotUser"("routerId", "disabled");

-- CreateTable: firewall rules
CREATE TABLE "FirewallRule" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "protocol" TEXT,
    "srcAddress" TEXT,
    "dstAddress" TEXT,
    "srcPort" TEXT,
    "dstPort" TEXT,
    "inInterface" TEXT,
    "outInterface" TEXT,
    "toAddresses" TEXT,
    "toPorts" TEXT,
    "comment" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "managed" BOOLEAN NOT NULL DEFAULT true,
    "mikrotikId" TEXT,
    CONSTRAINT "FirewallRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FirewallRule_routerId_table_chain_order_idx" ON "FirewallRule"("routerId", "table", "chain", "order");

-- CreateTable: queues
CREATE TABLE "Queue" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target" TEXT,
    "parent" TEXT,
    "maxLimit" TEXT,
    "limitAt" TEXT,
    "priority" INTEGER,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "mikrotikId" TEXT,
    CONSTRAINT "Queue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Queue_routerId_kind_name_key" ON "Queue"("routerId", "kind", "name");

-- CreateTable: backups
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "kmsKeyId" TEXT NOT NULL,
    "retentionUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Backup_routerId_createdAt_idx" ON "Backup"("routerId", "createdAt");

-- CreateTable: backup schedules
CREATE TABLE "BackupSchedule" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'export',
    "cron" TEXT NOT NULL DEFAULT '0 2 * * *',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "BackupSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BackupSchedule_routerId_type_key" ON "BackupSchedule"("routerId", "type");
CREATE INDEX "BackupSchedule_routerId_idx" ON "BackupSchedule"("routerId");

-- CreateTable: downstream devices
CREATE TABLE "DownstreamDevice" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "macAddress" TEXT,
    "lanIp" TEXT NOT NULL,
    "mgmtPort" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "proxyPort" INTEGER,
    "managedRouterId" TEXT,
    "lastSeen" TIMESTAMPTZ(3),
    CONSTRAINT "DownstreamDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DownstreamDevice_routerId_deviceId_key" ON "DownstreamDevice"("routerId", "deviceId");
CREATE INDEX "DownstreamDevice_routerId_idx" ON "DownstreamDevice"("routerId");

-- CreateTable: onboarding tokens
CREATE TABLE "OnboardingToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "siteId" TEXT,
    "sstpUsername" TEXT NOT NULL,
    "sstpPasswordRef" TEXT NOT NULL,
    "apiPasswordRef" TEXT NOT NULL,
    "tunnelIp" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "routerId" TEXT,
    CONSTRAINT "OnboardingToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnboardingToken_token_key" ON "OnboardingToken"("token");
CREATE UNIQUE INDEX "OnboardingToken_sstpUsername_key" ON "OnboardingToken"("sstpUsername");
CREATE UNIQUE INDEX "OnboardingToken_tunnelIp_key" ON "OnboardingToken"("tunnelIp");
CREATE INDEX "OnboardingToken_expiresAt_idx" ON "OnboardingToken"("expiresAt");

-- CreateTable: hotspot walled-garden
CREATE TABLE "HotspotWalledGarden" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'dns',
    "dstHost" TEXT,
    "dstAddress" TEXT,
    "action" TEXT NOT NULL DEFAULT 'allow',
    "comment" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "mikrotikId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HotspotWalledGarden_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HotspotWalledGarden_routerId_kind_idx" ON "HotspotWalledGarden"("routerId", "kind");

-- CreateTable: notification rules
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "template" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationRule_event_enabled_idx" ON "NotificationRule"("event", "enabled");

-- CreateTable: audit log (append-only — no UPDATE/DELETE in app code)
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "routerId" TEXT,
    "action" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "result" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuditLog_opId_key" ON "AuditLog"("opId");
CREATE INDEX "AuditLog_routerId_createdAt_idx" ON "AuditLog"("routerId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- Foreign keys
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SiteUser" ADD CONSTRAINT "SiteUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteUser" ADD CONSTRAINT "SiteUser_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Router" ADD CONSTRAINT "Router_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Downtime" ADD CONSTRAINT "Downtime_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotspotServer" ADD CONSTRAINT "HotspotServer_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotspotProfile" ADD CONSTRAINT "HotspotProfile_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotspotUserProfile" ADD CONSTRAINT "HotspotUserProfile_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotspotUser" ADD CONSTRAINT "HotspotUser_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotspotUser" ADD CONSTRAINT "HotspotUser_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "HotspotUserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FirewallRule" ADD CONSTRAINT "FirewallRule_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Queue" ADD CONSTRAINT "Queue_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BackupSchedule" ADD CONSTRAINT "BackupSchedule_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DownstreamDevice" ADD CONSTRAINT "DownstreamDevice_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotspotWalledGarden" ADD CONSTRAINT "HotspotWalledGarden_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingToken" ADD CONSTRAINT "OnboardingToken_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE SET NULL ON UPDATE CASCADE;
