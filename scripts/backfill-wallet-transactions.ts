import dotenv from "dotenv";
import type { Entity } from "@bartholfidel/shared";

dotenv.config();

/**
 * Backfill historical Web3 transaction metrics for all watched EOA wallets.
 *
 * Thin CLI wrapper around backfillWalletMetrics() (apps/api). The same routine
 * runs automatically when a new wallet is added via the API, so this script is
 * mainly for bulk/manual backfills.
 *
 * Usage: tsx scripts/backfill-wallet-transactions.ts [maxTransfersPerDirection]
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set in .env");
    process.exit(1);
  }

  const maxCount = Number(process.argv[2] ?? 1000);

  const { connectPostgres, disconnectPostgres } = await import(
    "../apps/api/src/db/postgres.js"
  );
  await connectPostgres(databaseUrl);

  const { listEoaWalletEntities } = await import(
    "../apps/api/src/repositories/web3.repository.js"
  );
  const { backfillWalletMetrics } = await import(
    "../apps/api/src/ingestion/web3/backfill.js"
  );

  const wallets: Entity[] = await listEoaWalletEntities();
  const watched = wallets.filter((w) => w.address);
  console.log(`backfill: ${watched.length} wallet(s) with addresses`);

  let totalEvents = 0;
  let totalMetricRows = 0;
  for (const wallet of watched) {
    const result = await backfillWalletMetrics(wallet, maxCount);
    totalEvents += result.events;
    totalMetricRows += result.metricRows;
  }

  console.log(
    `backfill complete: ${totalEvents} new raw event(s), ${totalMetricRows} metric row(s)`,
  );
  await disconnectPostgres();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
