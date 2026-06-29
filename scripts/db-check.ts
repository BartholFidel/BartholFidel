import { Pool } from 'pg';
import { loadConfig } from '../apps/api/src/config.js';

async function main() {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const ids = [
    '77d70f3f-960c-464a-9529-746030883086',
    '29c29e61-6ff3-4d82-b1a4-fce44d89828e',
  ];

  const rawResult = await pool.query(
    `SELECT e.name, e.address, r.event_type, r.event_timestamp, r.payload->>'tx_hash' AS tx_hash
     FROM raw_events r
     JOIN entities e ON e.id = r.entity_id
     WHERE e.id = ANY($1)
     ORDER BY r.ingest_timestamp DESC
     LIMIT 20`,
    [ids],
  );
  console.log('raw_events rows', rawResult.rows.length);
  console.table(rawResult.rows);

  const metricsResult = await pool.query(
    `SELECT e.name, e.address, em.metric, em.value, em.timestamp
     FROM entity_metrics_history em
     JOIN entities e ON e.id = em.entity_id
     WHERE e.id = ANY($1)
     ORDER BY em.timestamp DESC
     LIMIT 20`,
    [ids],
  );
  console.log('metric rows', metricsResult.rows.length);
  console.table(metricsResult.rows);

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});