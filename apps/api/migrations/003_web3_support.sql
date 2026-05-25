-- Week 5: Web3 transaction stream support

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

COMMENT ON COLUMN entities.last_active_at IS 'Timestamp of last detected transaction or activity';
