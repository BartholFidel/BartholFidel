-- Enforce one edge per (source, target, relationship_type) so re-running
-- relationship inference is idempotent (createRelationship uses ON CONFLICT).
ALTER TABLE entity_relationships
  ADD CONSTRAINT entity_relationships_unique_edge
  UNIQUE (source_entity_id, target_entity_id, relationship_type);

-- Reject self-loops at the database level.
ALTER TABLE entity_relationships
  ADD CONSTRAINT entity_relationships_no_self_loop
  CHECK (source_entity_id <> target_entity_id);

-- Traversal/lookup indexes for graph queries.
CREATE INDEX IF NOT EXISTS idx_entity_relationships_source
  ON entity_relationships (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_target
  ON entity_relationships (target_entity_id);
