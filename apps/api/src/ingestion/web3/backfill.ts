import { ethers } from "ethers";
import type { Entity } from "@bartholfidel/shared";
import { loadConfig } from "../../config.js";
import { getPostgresPool } from "../../db/postgres.js";
import {
  insertEntityMetricsBatch,
  insertRawEventIfNew,
} from "../../repositories/ingestion.repository.js";
import { fetchEthPrice } from "./utils.js";

interface AssetTransfer {
  hash: string;
  from: string | null;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  metadata?: { blockTimestamp?: string };
}

/** One transaction's worth of activity for a watched wallet. */
interface TxRecord {
  hash: string;
  timestampMs: number;
  counterparty: string | null;
  valueEth: number;
  contractInteraction: boolean;
}

interface DailyAccumulator {
  tx_count: number;
  volume_usd: number;
  unique_counterparties: Set<string>;
  contracts_interacted: number;
}

export interface BackfillResult {
  events: number;
  metricRows: number;
  days: number;
  transactions: number;
}

const TOKEN_CATEGORIES = new Set(["erc20", "erc721", "erc1155"]);

// Tried in order; high-volume addresses (e.g. exchange hot wallets) can make
// Alchemy error on the heavier `internal` category, so fall back to narrower
// category sets before giving up.
const CATEGORY_FALLBACKS: string[][] = [
  ["external", "internal", "erc20", "erc721", "erc1155"],
  ["external", "erc20", "erc721", "erc1155"],
  ["external", "erc20"],
  ["external"],
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rpcHttpUrl(): string | null {
  const config = loadConfig();
  const url = process.env.ALCHEMY_HTTP_URL ?? config.alchemyWsUrl;
  if (!url) {
    return null;
  }
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

async function getAssetTransfers(
  provider: ethers.JsonRpcProvider,
  params: { fromAddress?: string; toAddress?: string; maxCount: number },
): Promise<AssetTransfer[]> {
  let lastError: unknown;

  for (const categories of CATEGORY_FALLBACKS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = (await provider.send("alchemy_getAssetTransfers", [
          {
            fromBlock: "0x0",
            toBlock: "latest",
            ...(params.fromAddress ? { fromAddress: params.fromAddress } : {}),
            ...(params.toAddress ? { toAddress: params.toAddress } : {}),
            category: categories,
            withMetadata: true,
            excludeZeroValue: false,
            order: "desc",
            maxCount: `0x${params.maxCount.toString(16)}`,
          },
        ])) as { transfers?: AssetTransfer[] };
        return result.transfers ?? [];
      } catch (error) {
        lastError = error;
        await delay(500 * (attempt + 1));
      }
    }
    console.warn(
      `[web3-backfill] getAssetTransfers failed for categories [${categories.join(
        ", ",
      )}], trying a narrower set`,
    );
  }

  throw lastError;
}

/** Collapse raw transfers (a tx can emit several) into one record per tx hash. */
function toTxRecords(transfers: AssetTransfer[], walletAddress: string): TxRecord[] {
  const wallet = walletAddress.toLowerCase();
  const byHash = new Map<string, TxRecord>();

  for (const t of transfers) {
    const ts = t.metadata?.blockTimestamp
      ? Date.parse(t.metadata.blockTimestamp)
      : NaN;
    if (Number.isNaN(ts)) {
      continue;
    }

    const from = t.from?.toLowerCase() ?? null;
    const to = t.to?.toLowerCase() ?? null;
    const counterparty = from === wallet ? to : from;
    const valueEth =
      (t.category === "external" || t.category === "internal") &&
      typeof t.value === "number"
        ? t.value
        : 0;
    const isContractTransfer = TOKEN_CATEGORIES.has(t.category);

    const existing = byHash.get(t.hash);
    if (existing) {
      existing.valueEth += valueEth;
      existing.contractInteraction =
        existing.contractInteraction || isContractTransfer;
      if (!existing.counterparty && counterparty) {
        existing.counterparty = counterparty;
      }
    } else {
      byHash.set(t.hash, {
        hash: t.hash,
        timestampMs: ts,
        counterparty,
        valueEth,
        contractInteraction: isContractTransfer,
      });
    }
  }

  return [...byHash.values()];
}

function dayKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split("T")[0]!;
}

function dayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/**
 * Backfill historical Web3 transaction metrics for a single watched wallet.
 *
 * Uses Alchemy's `alchemy_getAssetTransfers` to pull the wallet's recent
 * transfer history, aggregates the same daily metrics the live stream produces
 * (tx_count_per_day, volume_usd_per_day, unique_counterparties_per_day,
 * contracts_interacted_per_day), and updates last_active_at.
 *
 * Idempotent: clears prior per-day aggregates for the entity before inserting.
 */
export async function backfillWalletMetrics(
  entity: Entity,
  maxCount = 1000,
): Promise<BackfillResult> {
  const empty: BackfillResult = {
    events: 0,
    metricRows: 0,
    days: 0,
    transactions: 0,
  };

  if (!entity.address) {
    console.warn(`[web3-backfill] entity ${entity.id} has no address, skipping`);
    return empty;
  }

  const httpUrl = rpcHttpUrl();
  if (!httpUrl) {
    console.warn("[web3-backfill] no Alchemy URL configured, skipping backfill");
    return empty;
  }

  const provider = new ethers.JsonRpcProvider(httpUrl);
  const address = entity.address.toLowerCase();
  const ethPrice = await fetchEthPrice();

  const [sent, received] = await Promise.all([
    getAssetTransfers(provider, { fromAddress: address, maxCount }).catch(
      (e: unknown) => {
        console.error(`[web3-backfill] sent-transfers fetch failed for ${address}:`, e);
        return [] as AssetTransfer[];
      },
    ),
    getAssetTransfers(provider, { toAddress: address, maxCount }).catch(
      (e: unknown) => {
        console.error(`[web3-backfill] received-transfers fetch failed for ${address}:`, e);
        return [] as AssetTransfer[];
      },
    ),
  ]);
  const txs = toTxRecords([...sent, ...received], address);
  console.log(
    `[web3-backfill] ${entity.name} (${address}) -> ${txs.length} unique tx(s)`,
  );

  if (txs.length === 0) {
    return empty;
  }

  const daily = new Map<string, DailyAccumulator>();
  let maxTimestampMs = 0;
  let events = 0;

  for (const tx of txs) {
    if (tx.timestampMs > maxTimestampMs) {
      maxTimestampMs = tx.timestampMs;
    }

    const inserted = await insertRawEventIfNew({
      entityId: entity.id,
      eventType: "web3_transaction",
      source: "web3-backfill",
      eventTimestamp: new Date(tx.timestampMs),
      payload: {
        from_address: address,
        to_address: tx.counterparty,
        value_eth: tx.valueEth,
        value_usd: tx.valueEth * ethPrice,
        gas_used: 0,
        contract_interaction: tx.contractInteraction,
        timestamp: Math.floor(tx.timestampMs / 1000),
        tx_hash: tx.hash,
      },
    }).catch((e: unknown) => {
      console.error(`[web3-backfill] insertRawEventIfNew error for ${tx.hash}:`, e);
      return false;
    });

    if (inserted) {
      events += 1;
    }

    const key = dayKey(tx.timestampMs);
    let acc = daily.get(key);
    if (!acc) {
      acc = {
        tx_count: 0,
        volume_usd: 0,
        unique_counterparties: new Set(),
        contracts_interacted: 0,
      };
      daily.set(key, acc);
    }
    acc.tx_count += 1;
    acc.volume_usd += tx.valueEth * ethPrice;
    if (tx.counterparty) {
      acc.unique_counterparties.add(tx.counterparty);
    }
    if (tx.contractInteraction) {
      acc.contracts_interacted += 1;
    }
  }

  const metrics: Array<{
    entityId: string;
    metric: string;
    value: number;
    timestamp: Date;
  }> = [];

  for (const [key, acc] of daily.entries()) {
    const timestamp = dayStart(key);
    metrics.push(
      { entityId: entity.id, metric: "tx_count_per_day", value: acc.tx_count, timestamp },
      { entityId: entity.id, metric: "volume_usd_per_day", value: acc.volume_usd, timestamp },
      {
        entityId: entity.id,
        metric: "unique_counterparties_per_day",
        value: acc.unique_counterparties.size,
        timestamp,
      },
      {
        entityId: entity.id,
        metric: "contracts_interacted_per_day",
        value: acc.contracts_interacted,
        timestamp,
      },
    );
  }

  if (metrics.length > 0) {
    // Clear prior backfilled per-day aggregates so re-runs recompute cleanly
    // (insertEntityMetricsBatch is append-only).
    await getPostgresPool().query(
      `DELETE FROM entity_metrics_history
       WHERE entity_id = $1 AND metric LIKE '%\\_per\\_day'`,
      [entity.id],
    );
    await insertEntityMetricsBatch(metrics);
  }

  if (maxTimestampMs > 0) {
    await getPostgresPool().query(
      `UPDATE entities SET last_active_at = $2, updated_at = now() WHERE id = $1`,
      [entity.id, new Date(maxTimestampMs)],
    );
  }

  console.log(
    `[web3-backfill] ${entity.name} -> ${events} new event(s), ${metrics.length} metric row(s) across ${daily.size} day(s)`,
  );

  return {
    events,
    metricRows: metrics.length,
    days: daily.size,
    transactions: txs.length,
  };
}
