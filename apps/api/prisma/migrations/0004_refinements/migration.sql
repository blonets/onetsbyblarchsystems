-- P1 refinements: router tags, hotspot batch/expiry/MAC fields,
-- firewall rollback journal (+ revoked soft-delete), worker-reported sessions.

-- Router tags (tag-based groups for fleet bulk ops)
ALTER TABLE "Router" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- HotspotUserProfile: MAC pin, explicit expiry clocks, voucher price
ALTER TABLE "HotspotUserProfile" ADD COLUMN "macAddress" TEXT;
ALTER TABLE "HotspotUserProfile" ADD COLUMN "limitUptime" TEXT;
ALTER TABLE "HotspotUserProfile" ADD COLUMN "validitySeconds" INTEGER;
ALTER TABLE "HotspotUserProfile" ADD COLUMN "price" DOUBLE PRECISION;
ALTER TABLE "HotspotUserProfile" ADD COLUMN "expiryMode" TEXT NOT NULL DEFAULT 'none';

-- HotspotUser: generation mode/batch, explicit expiry clocks, MAC pin
ALTER TABLE "HotspotUser" ADD COLUMN "mode" TEXT;
ALTER TABLE "HotspotUser" ADD COLUMN "batchId" TEXT;
ALTER TABLE "HotspotUser" ADD COLUMN "validityFromFirstLogin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HotspotUser" ADD COLUMN "validitySeconds" INTEGER;
ALTER TABLE "HotspotUser" ADD COLUMN "limitUptime" TEXT;
ALTER TABLE "HotspotUser" ADD COLUMN "firstLoginAt" TIMESTAMPTZ(3);
ALTER TABLE "HotspotUser" ADD COLUMN "macAddress" TEXT;
ALTER TABLE "HotspotUser" ADD COLUMN "expiryMode" TEXT NOT NULL DEFAULT 'none';
CREATE INDEX "HotspotUser_batchId_idx" ON "HotspotUser"("batchId");

-- FirewallRule: revoked soft-delete marker (rollback revokes, never hard-deletes)
ALTER TABLE "FirewallRule" ADD COLUMN "revoked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: HotspotBatch
CREATE TABLE "HotspotBatch" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL,
    "codeLength" INTEGER NOT NULL,
    "profileId" TEXT,
    "note" TEXT,
    "opId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HotspotBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HotspotBatch_opId_key" ON "HotspotBatch"("opId");
CREATE INDEX "HotspotBatch_routerId_idx" ON "HotspotBatch"("routerId");
ALTER TABLE "HotspotBatch" ADD CONSTRAINT "HotspotBatch_routerId_fkey"
    FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotspotUser" ADD CONSTRAINT "HotspotUser_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "HotspotBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: HotspotActiveSession (worker-reported, replaced wholesale per ingest)
CREATE TABLE "HotspotActiveSession" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "address" TEXT,
    "macAddress" TEXT,
    "uptime" TEXT,
    "server" TEXT,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HotspotActiveSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HotspotActiveSession_routerId_idx" ON "HotspotActiveSession"("routerId");
CREATE INDEX "HotspotActiveSession_username_idx" ON "HotspotActiveSession"("username");
ALTER TABLE "HotspotActiveSession" ADD CONSTRAINT "HotspotActiveSession_routerId_fkey"
    FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: FirewallJournal (rollback records for firewall changes)
CREATE TABLE "FirewallJournal" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "chain" TEXT,
    "ruleId" TEXT,
    "before" JSONB NOT NULL,
    "createdRuleIds" JSONB NOT NULL DEFAULT '[]',
    "sentences" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMPTZ(3),
    CONSTRAINT "FirewallJournal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FirewallJournal_opId_key" ON "FirewallJournal"("opId");
CREATE INDEX "FirewallJournal_routerId_idx" ON "FirewallJournal"("routerId");
ALTER TABLE "FirewallJournal" ADD CONSTRAINT "FirewallJournal_routerId_fkey"
    FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
