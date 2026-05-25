import dotenv from "dotenv";
import { Pool } from "pg";
import { loadConfig } from "../config.js";

dotenv.config();

async function deleteDuplicateIncidents(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });

  try {
    console.log("Deleting duplicate incidents...");
    
    const result = await pool.query(`
      DELETE FROM incidents 
      WHERE (entity_id, attack_pattern, created_at) NOT IN (
        SELECT entity_id, attack_pattern, MIN(created_at) 
        FROM incidents 
        GROUP BY entity_id, attack_pattern
      )
    `);

    console.log(`✓ Deleted ${result.rowCount} duplicate incident(s)`);
  } catch (error) {
    console.error("Error deleting duplicate incidents:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

deleteDuplicateIncidents().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
