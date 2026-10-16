-- Vendor-neutral downstream device identity (Phase 1: discovery + proxy ports).
-- Phase 2 per-vendor drivers consume these columns via the DeviceDriver contract.
ALTER TABLE "DownstreamDevice" ADD COLUMN "vendor" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "DownstreamDevice" ADD COLUMN "model" TEXT;
ALTER TABLE "DownstreamDevice" ADD COLUMN "mgmtMethods" JSONB;
