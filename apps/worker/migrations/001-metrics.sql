-- Migration 001: metrics + downtime ledger hypertables (TimescaleDB)
--
-- Deploy: psql $DATABASE_URL -f migrations/001-metrics.sql
-- Requires: PostgreSQL 14+ with the TimescaleDB extension.
--
-- Retention / compression policy (ARCH §4):
--   - 1-day chunks, compression after 7 days, retention 90 days (configurable
--     via the DO block at the bottom)
--   - continuous aggregates feed the dashboards at 1h / 1d resolution

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- router_metrics: one row per router per poll tick (60 s cadence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS router_metrics (
  ts            TIMESTAMPTZ NOT NULL,
  router_id     TEXT        NOT NULL,
  cpu_load_pct  DOUBLE PRECISION,
  free_mem_bytes  BIGINT,
  total_mem_bytes BIGINT,
  uptime_sec    BIGINT,
  hotspot_active  INTEGER NOT NULL DEFAULT 0,
  hotspot_users   INTEGER NOT NULL DEFAULT 0
);

SELECT create_hypertable('router_metrics', 'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS router_metrics_router_ts_idx
  ON router_metrics (router_id, ts DESC);

-- ---------------------------------------------------------------------------
-- interface_metrics: per-interface counters + derived rates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interface_metrics (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  ifname    TEXT        NOT NULL,
  rx_bytes  BIGINT NOT NULL DEFAULT 0,
  tx_bytes  BIGINT NOT NULL DEFAULT 0,
  rx_bps    BIGINT NOT NULL DEFAULT 0,
  tx_bps    BIGINT NOT NULL DEFAULT 0
);

SELECT create_hypertable('interface_metrics', 'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS interface_metrics_router_iface_ts_idx
  ON interface_metrics (router_id, ifname, ts DESC);

-- ---------------------------------------------------------------------------
-- downtime_ledger: one row per outage window (canonical DowntimeEntry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS downtime_ledger (
  id          TEXT PRIMARY KEY,
  router_id   TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  duration_s  BIGINT,
  cause       TEXT
);

CREATE INDEX IF NOT EXISTS downtime_ledger_router_idx
  ON downtime_ledger (router_id, started_at DESC);

-- Open outages have NULL ended_at; this partial index keeps the
-- "currently down" query cheap.
CREATE INDEX IF NOT EXISTS downtime_ledger_open_idx
  ON downtime_ledger (router_id)
  WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- poll_gaps: recorded when a router's poll gap exceeds 2x cadence (ARCH §5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_gaps (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  gap_sec   DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('poll_gaps', 'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- backups: metadata for encrypted backup objects (canonical BackupRecord)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backups (
  id              TEXT PRIMARY KEY,
  router_id       TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('binary', 'export')),
  file_name       TEXT NOT NULL,
  storage_key     TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  sha256          TEXT NOT NULL,
  kms_key_id      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS backups_router_idx ON backups (router_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backups_retention_idx ON backups (retention_until);

-- ---------------------------------------------------------------------------
-- Continuous aggregates: 1h and 1d rollups for dashboards
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS router_metrics_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  router_id,
  avg(cpu_load_pct)   AS cpu_load_pct_avg,
  max(cpu_load_pct)   AS cpu_load_pct_max,
  avg(hotspot_active) AS hotspot_active_avg,
  max(hotspot_active) AS hotspot_active_max,
  avg(hotspot_users)  AS hotspot_users_avg
FROM router_metrics
GROUP BY bucket, router_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('router_metrics_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS router_metrics_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  router_id,
  avg(cpu_load_pct)   AS cpu_load_pct_avg,
  max(cpu_load_pct)   AS cpu_load_pct_max,
  avg(hotspot_active) AS hotspot_active_avg,
  max(hotspot_active) AS hotspot_active_max
FROM router_metrics
GROUP BY bucket, router_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('router_metrics_daily',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- Compression + retention (tune via the DO block)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  retention_days integer := 90;
BEGIN
  PERFORM set_chunk_time_interval('router_metrics', INTERVAL '1 day');
  ALTER TABLE router_metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'router_id',
    timescaledb.compress_orderby = 'ts DESC'
  );
  PERFORM add_compression_policy('router_metrics', INTERVAL '7 days', if_not_exists => TRUE);
  PERFORM add_retention_policy('router_metrics', (retention_days || ' days')::interval, if_not_exists => TRUE);

  ALTER TABLE interface_metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'router_id, ifname',
    timescaledb.compress_orderby = 'ts DESC'
  );
  PERFORM add_compression_policy('interface_metrics', INTERVAL '7 days', if_not_exists => TRUE);
  PERFORM add_retention_policy('interface_metrics', (retention_days || ' days')::interval, if_not_exists => TRUE);

  PERFORM add_retention_policy('poll_gaps', (retention_days || ' days')::interval, if_not_exists => TRUE);
END $$;
