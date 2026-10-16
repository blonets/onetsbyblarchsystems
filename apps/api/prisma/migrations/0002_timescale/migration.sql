-- TimescaleDB hypertables for metric ingestion.
-- Prisma doesn't manage hypertables natively, so they are created here in raw
-- SQL. `router_id` is TEXT (no FK) — hypertables + FKs to non-hypertables
-- don't mix well; join in app code.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS metric_cpu (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  cpu_pct   DOUBLE PRECISION NOT NULL
);
SELECT create_hypertable('metric_cpu', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS metric_mem (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  total_kb  BIGINT NOT NULL,
  free_kb   BIGINT NOT NULL
);
SELECT create_hypertable('metric_mem', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS metric_traffic (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  iface     TEXT        NOT NULL,
  rx_bps    BIGINT NOT NULL,
  tx_bps    BIGINT NOT NULL
);
SELECT create_hypertable('metric_traffic', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS metric_hotspot_active (
  ts        TIMESTAMPTZ NOT NULL,
  router_id TEXT        NOT NULL,
  active_n  INTEGER NOT NULL
);
SELECT create_hypertable('metric_hotspot_active', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

-- Retention (tune per deployment)
SELECT add_retention_policy('metric_cpu',            INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('metric_mem',            INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('metric_traffic',        INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('metric_hotspot_active', INTERVAL '90 days', if_not_exists => TRUE);

-- Compression: traffic is the highest-volume table
ALTER TABLE metric_traffic SET (timescaledb.compress,
  timescaledb.compress_segmentby = 'router_id,iface',
  timescaledb.compress_orderby = 'ts DESC');
SELECT add_compression_policy('metric_traffic', INTERVAL '7 days', if_not_exists => TRUE);

-- 1-hour rollups for dashboards (continuous aggregate)
-- WITH NO DATA is REQUIRED: Prisma runs each migration inside a single
-- transaction, and CREATE MATERIALIZED VIEW ... WITH DATA cannot run inside
-- a transaction block (this exact error failed this migration in production
-- on 2026-10-16 → Prisma P3009 on every later deploy). The refresh policy
-- below populates the aggregate on its schedule.
CREATE MATERIALIZED VIEW IF NOT EXISTS metric_traffic_1h
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', ts) AS bucket, router_id, iface,
       avg(rx_bps)::bigint AS rx_bps, avg(tx_bps)::bigint AS tx_bps
FROM metric_traffic GROUP BY bucket, router_id, iface
WITH NO DATA;
SELECT add_continuous_aggregate_policy('metric_traffic_1h',
  start_offset => INTERVAL '3 hours', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
