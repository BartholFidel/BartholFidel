import { getPostgresPool } from "../db/postgres.js";

const DORMANCY_THRESHOLD_DAYS = 60;

/**
 * Detect if a wallet was dormant and has just been activated.
 * If so, create a CRITICAL incident with pattern WEB3_004.
 */
export async function evaluateWeb3Dormancy(entityId: string): Promise<void> {
  const pool = getPostgresPool();

  // Get the wallet entity
  const entityResult = await pool.query<{
    id: string;
    name: string;
    last_active_at: Date | null;
  }>(
    `SELECT id, name, last_active_at FROM entities WHERE id = $1`,
    [entityId],
  );

  const entity = entityResult.rows[0];
  if (!entity) {
    return;
  }

  // Check if wallet was previously dormant (last_active_at is old)
  const lastActiveAt = entity.last_active_at;
  const now = new Date();
  const daysSinceLastActive = lastActiveAt
    ? (now.getTime() - lastActiveAt.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;

  // Only fire if dormancy was >= threshold
  if (daysSinceLastActive < DORMANCY_THRESHOLD_DAYS) {
    return;
  }

  // Get the previous last_active_at value before the update
  // We need to find the second-most-recent transaction
  const prevTxResult = await pool.query<{ event_timestamp: Date | null }>(
    `SELECT event_timestamp FROM raw_events 
     WHERE entity_id = $1 AND event_type = 'web3_transaction'
     ORDER BY event_timestamp DESC LIMIT 2`,
    [entityId],
  );

  // If there's only one transaction, it must have been dormant before
  if (prevTxResult.rows.length > 0) {
    const dormantDays = Math.floor(daysSinceLastActive);

    // Create CRITICAL incident
    const incidentResult = await pool.query<{ id: string }>(
      `INSERT INTO incidents (entity_id, composite_score, tier, status, surface, attack_pattern)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        entityId,
        85.0, // High composite score for dormancy activation
        "critical",
        "open",
        "web3",
        "WEB3_004",
      ],
    );

    const incidentId = incidentResult.rows[0]?.id;
    if (incidentId) {
      console.log(
        `[web3-alerts] incident created for dormant wallet ${entity.name}: dormant for ${dormantDays} days`,
      );
    }
  }
}
