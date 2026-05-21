-- BartholFidel initial PostgreSQL schema (Week 1)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Monitored assets (wallets, contracts, accounts, etc.)
CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  type varchar NOT NULL,
  source varchar NOT NULL CHECK (source IN ('web2', 'web3')),
  chain_id integer,
  address varchar,
  config jsonb DEFAULT '{}',
  risk_tier varchar DEFAULT 'low',
  historically_compromised boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ingested telemetry before processing
CREATE TABLE raw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES entities(id),
  event_type varchar NOT NULL,
  source varchar NOT NULL,
  ingest_timestamp timestamptz DEFAULT now(),
  event_timestamp timestamptz,
  payload jsonb NOT NULL,
  payload_hash varchar UNIQUE,
  processed boolean DEFAULT false
);

-- Time-series metric observations per entity
CREATE TABLE entity_metrics_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES entities(id),
  metric varchar NOT NULL,
  value numeric NOT NULL,
  timestamp timestamptz DEFAULT now()
);

-- Statistical baselines used for anomaly detection
CREATE TABLE entity_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES entities(id),
  metric varchar NOT NULL,
  window_days integer NOT NULL,
  mean numeric,
  std_dev numeric,
  p50 numeric,
  p95 numeric,
  p99 numeric,
  sample_count integer DEFAULT 0,
  weight_adjustment numeric DEFAULT 1.0,
  computed_at timestamptz DEFAULT now()
);

-- Per-metric anomaly scores (z-scores vs baseline)
CREATE TABLE anomaly_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES entities(id),
  metric varchar NOT NULL,
  observed_value numeric NOT NULL,
  baseline_mean numeric,
  baseline_std_dev numeric,
  z_score numeric NOT NULL,
  timestamp timestamptz DEFAULT now()
);

-- Correlated alerts escalated from anomaly signals
CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES entities(id),
  composite_score numeric NOT NULL,
  tier varchar NOT NULL CHECK (tier IN ('info', 'warning', 'critical')),
  status varchar DEFAULT 'open',
  triggered_metrics jsonb DEFAULT '[]',
  corroborating_signals jsonb DEFAULT '[]',
  surface varchar NOT NULL,
  attack_pattern varchar,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

-- Analyst feedback on incident verdicts
CREATE TABLE alert_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid REFERENCES incidents(id),
  verdict varchar NOT NULL,
  reason_category varchar,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Temporary or scoped alert suppression rules
CREATE TABLE suppression_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES entities(id),
  rule_type varchar NOT NULL,
  config jsonb DEFAULT '{}',
  active_from timestamptz,
  active_until timestamptz NOT NULL,
  last_fired_at timestamptz,
  fire_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Graph edges between monitored entities
CREATE TABLE entity_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id uuid REFERENCES entities(id),
  target_entity_id uuid REFERENCES entities(id),
  relationship_type varchar NOT NULL,
  confidence numeric DEFAULT 1.0,
  last_confirmed_at timestamptz DEFAULT now()
);
