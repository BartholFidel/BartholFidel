BEGIN;

-- Remove duplicate incidents, keeping the oldest per entity_id + attack_pattern.
DELETE FROM incidents
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY entity_id, attack_pattern
             ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM incidents
  ) sub
  WHERE sub.rn > 1
);

-- Enforce uniqueness for incident entity/attack pattern combinations.
ALTER TABLE incidents
  ADD CONSTRAINT incidents_entity_attack_pattern_unique
  UNIQUE (entity_id, attack_pattern);

COMMIT;
