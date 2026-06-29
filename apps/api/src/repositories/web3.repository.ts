import type { Entity } from "@bartholfidel/shared";
import { getPostgresPool } from "../db/postgres.js";

interface EntityRow {
  id: string;
  name: string;
  type: string;
  source: string;
  chain_id: number | null;
  address: string | null;
  config: Record<string, unknown>;
  risk_tier: string;
  historically_compromised: boolean;
  created_at: Date;
  updated_at: Date;
  last_active_at: Date | null;
}

function mapEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source as Entity["source"],
    chain_id: row.chain_id,
    address: row.address,
    config: row.config ?? {},
    risk_tier: row.risk_tier,
    historically_compromised: row.historically_compromised,
    last_active_at: row.last_active_at ? row.last_active_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * List all EOA wallet entities on the web3 watchlist.
 */
async function listWeb3EntitiesByType(types: string[]): Promise<Entity[]> {
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities 
     WHERE source = 'web3' AND type = ANY($1::text[])
     ORDER BY created_at DESC`,
    [types],
  );
  return result.rows.map(mapEntity);
}

export async function listEoaWalletEntities(): Promise<Entity[]> {
  return listWeb3EntitiesByType(["eoa_wallet"]);
}

export async function listContractWatchEntities(): Promise<Entity[]> {
  return listWeb3EntitiesByType(["smart_contract", "token", "liquidity_pool"]);
}

export async function listTokenEntities(): Promise<Entity[]> {
  return listWeb3EntitiesByType(["token"]);
}

export async function listLiquidityPoolEntities(): Promise<Entity[]> {
  return listWeb3EntitiesByType(["liquidity_pool"]);
}

/**
 * Update the last_active_at timestamp for an entity (typically an EOA wallet).
 */
export async function updateEntityLastActiveAt(entityId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE entities 
     SET last_active_at = now(), updated_at = now()
     WHERE id = $1`,
    [entityId],
  );
}

/**
 * Get an entity by ID with full details including last_active_at.
 */
export async function getEoaWalletEntityById(id: string): Promise<Entity | null> {
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities WHERE id = $1 AND source = 'web3' AND type = 'eoa_wallet'`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapEntity(row) : null;
}

/**
 * List all EOA wallets that have been dormant for N+ days
 */
export async function listDormantEoaWallets(dormantDays: number): Promise<Entity[]> {
  const pool = getPostgresPool();
  const result = await pool.query<EntityRow>(
    `SELECT * FROM entities 
     WHERE source = 'web3' 
       AND type = 'eoa_wallet' 
       AND (last_active_at IS NULL OR last_active_at < now() - interval '1 day' * $1)
     ORDER BY last_active_at DESC`,
    [dormantDays],
  );
  return result.rows.map(mapEntity);
}

/**
 * Get raw last_active_at timestamp as Date for a wallet entity.
 */
export async function getEntityLastActiveAt(entityId: string): Promise<Date | null> {
  const pool = getPostgresPool();
  const result = await pool.query<{ last_active_at: Date | null }>(
    `SELECT last_active_at FROM entities WHERE id = $1`,
    [entityId],
  );
  const row = result.rows[0];
  return row?.last_active_at ?? null;
}
