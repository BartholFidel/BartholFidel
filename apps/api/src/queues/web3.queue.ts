import type { Entity } from "@bartholfidel/shared";
import { backfillWalletMetrics } from "../ingestion/web3/backfill.js";
import {
  addWalletToStream,
  startWeb3TransactionStream,
  stopWeb3TransactionStream,
} from "../ingestion/web3/transaction.stream.js";
import {
  startWeb3ContractEventDecoder,
  stopWeb3ContractEventDecoder,
} from "../ingestion/web3/event.decoder.js";
import {
  startWeb3PriceOracleScheduler,
  stopWeb3PriceOracleScheduler,
} from "../ingestion/web3/price.oracle.js";
import {
  startWeb3MempoolWatcher,
  stopWeb3MempoolWatcher,
} from "../ingestion/web3/mempool.watcher.js";

let web3WatchersStarted = false;

export async function startWeb3StreamScheduler(
  wsUrl: string,
  apiKey: string | null,
): Promise<void> {
  if (web3WatchersStarted) {
    console.warn("[web3-queue] web3 watchers already running");
    return;
  }

  try {
    await Promise.all([
      startWeb3TransactionStream(wsUrl, apiKey),
      startWeb3ContractEventDecoder(wsUrl, apiKey),
      startWeb3PriceOracleScheduler(wsUrl, apiKey),
      startWeb3MempoolWatcher(wsUrl, apiKey),
    ]);
    web3WatchersStarted = true;
    console.log("[web3-queue] Web3 watchers started");
  } catch (error) {
    console.error("[web3-queue] failed to start web3 watchers:", error);
    web3WatchersStarted = false;
    throw error;
  }
}

export async function stopWeb3StreamScheduler(): Promise<void> {
  if (!web3WatchersStarted) {
    return;
  }

  try {
    await Promise.all([
      stopWeb3TransactionStream(),
      stopWeb3ContractEventDecoder(),
      stopWeb3PriceOracleScheduler(),
      stopWeb3MempoolWatcher(),
    ]);
    web3WatchersStarted = false;
    console.log("[web3-queue] Web3 watchers stopped");
  } catch (error) {
    console.error("[web3-queue] error stopping web3 watchers:", error);
  }
}

export function isWeb3StreamRunning(): boolean {
  return web3WatchersStarted;
}

/**
 * Called when a new web3 EOA wallet is added to the watchlist. Registers it with
 * the live stream immediately and backfills its historical transaction metrics
 * in the background so the entity shows metrics without an API restart.
 */
export function handleNewWeb3Wallet(entity: Entity): void {
  addWalletToStream(entity);
  void backfillWalletMetrics(entity)
    .then((result) => {
      console.log(
        `[web3-queue] backfilled ${entity.name}: ${result.metricRows} metric row(s) across ${result.days} day(s)`,
      );
    })
    .catch((error: unknown) => {
      console.error(`[web3-queue] backfill failed for ${entity.name}:`, error);
    });
}
