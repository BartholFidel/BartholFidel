import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";
import { loadConfig } from "./config.js";

dotenv.config();

const MIGRATIONS_TABLE = "schema_migrations";

interface MigrationRow {
  name: string;
}

/**
 * Runs pending SQL migrations from apps/api/migrations in filename order.
 */
async function runMigrations(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });

  const migrationsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "migrations",
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id serial PRIMARY KEY,
      name varchar NOT NULL UNIQUE,
      applied_at timestamptz DEFAULT now()
    )
  `);

  const appliedResult = await pool.query<MigrationRow>(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`,
  );
  const applied = new Set(appliedResult.rows.map((row) => row.name));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip ${file} (already applied)`);
      continue;
    }

    const sqlPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(sqlPath, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`,
        [file],
      );
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log("[migrate] complete");
}

runMigrations().catch((error: unknown) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
