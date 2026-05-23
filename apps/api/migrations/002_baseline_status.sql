-- Week 3: baseline cold-start status for entities with insufficient history

ALTER TABLE entity_baselines
  ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'active';

COMMENT ON COLUMN entity_baselines.status IS 'active | insufficient_data';
