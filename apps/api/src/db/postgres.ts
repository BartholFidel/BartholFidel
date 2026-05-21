import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;

/** Returns the shared PostgreSQL connection pool (lazy singleton). */
export function getPostgresPool(): Pool {
  if (!pool) {
    throw new Error("PostgreSQL pool not initialized. Call connectPostgres first.");
  }
  return pool;
}

/**
 * Connects to PostgreSQL and verifies connectivity with a simple query.
 */
export async function connectPostgres(databaseUrl: string): Promise<void> {
  pool = new Pool({ connectionString: databaseUrl });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

/** Gracefully closes the PostgreSQL pool. */
export async function disconnectPostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
