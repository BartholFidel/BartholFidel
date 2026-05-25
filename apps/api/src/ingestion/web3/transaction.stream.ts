import { ethers } from "ethers";
import type { Entity } from "@bartholfidel/shared";
import { evaluateWeb3Dormancy } from "../../alerts/web3.alerts.js";
import {
  insertEntityMetricsBatch,
  insertRawEventIfNew,
} from "../../repositories/ingestion.repository.js";
import {
  listEoaWalletEntities,
  updateEntityLastActiveAt,
} from "../../repositories/web3.repository.js";
import { getPostgresPool } from "../../db/postgres.js";

const COINGECKO_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

interface TransactionDetails {
  from_address: string;
  to_address: string | null;
  value_eth: number;
  value_usd: number;
  gas_used: number;
  contract_interaction: boolean;
  timestamp: number;
  tx_hash: string;
}

interface DailyMetricsAccumulator {
  tx_count: number;
  volume_usd: number;
  unique_counterparties: Set<string>;
  contracts_interacted: number;
}

/**
 * Manages the Web3 transaction stream subscription and metric aggregation.
 */
export class Web3TransactionStream {
  private provider: ethers.WebSocketProvider | null = null;
  private subscriptions: Map<string, ethers.ContractEventPayload> = new Map();
  private ethPriceCache: { value: number; timestamp: number } | null = null;
  private dailyMetrics: Map<string, DailyMetricsAccumulator> = new Map();
  private metricsFlushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private wsUrl: string,
    private apiKey: string | null,
  ) {}

  /**
   * Initialize the WebSocket provider and start subscribing to wallets.
   */
  async start(): Promise<void> {
    if (!this.wsUrl) {
      console.warn("[web3-stream] ALCHEMY_WS_URL not configured, skipping");
      return;
    }

    try {
      this.provider = new ethers.WebSocketProvider(this.wsUrl);
      console.log("[web3-stream] WebSocket provider initialized");

      // Set up error handling for the provider
      this.provider.on("error", (error: Error) => {
        console.error("[web3-stream] provider error:", error);
      });

      const wallets = await listEoaWalletEntities();
      console.log(`[web3-stream] subscribing to ${wallets.length} EOA wallets`);

      for (const wallet of wallets) {
        await this.subscribeToWallet(wallet);
      }

      // Flush accumulated metrics every 5 minutes
      this.metricsFlushInterval = setInterval(
        () => {
          void this.flushDailyMetrics();
        },
        5 * 60 * 1000,
      );
    } catch (error) {
      console.error("[web3-stream] startup failed:", error);
      throw error;
    }
  }

  /**
   * Stop the stream and clean up subscriptions.
   */
  async stop(): Promise<void> {
    if (this.metricsFlushInterval) {
      clearInterval(this.metricsFlushInterval);
    }

    // Flush any remaining metrics before shutdown
    await this.flushDailyMetrics();

    if (this.provider) {
      await this.provider.destroy();
      this.provider = null;
    }

    this.subscriptions.clear();
    console.log("[web3-stream] stream stopped");
  }

  /**
   * Subscribe to transactions for a specific EOA wallet.
   */
  private async subscribeToWallet(wallet: Entity): Promise<void> {
    if (!this.provider) {
      return;
    }

    if (!wallet.address) {
      console.warn(
        `[web3-stream] wallet entity ${wallet.id} has no address`,
      );
      return;
    }

    try {
      const checksummed = ethers.getAddress(wallet.address);

      // Watch for transactions from this address
      const fromFilter = this.provider.on(
        {
          // Transactions sent from this address
          topics: [null],
          address: checksummed,
        },
        async (log) => {
          if (log.topics[0] === null) {
            await this.processTransaction(wallet, log);
          }
        },
      );

      // Also listen to any incoming transactions (to_address matches)
      const toFilter = this.provider.on(
        {
          address: checksummed,
        },
        async (log) => {
          await this.processTransaction(wallet, log);
        },
      );

      this.subscriptions.set(wallet.id, { fromFilter, toFilter } as any);
      console.log(`[web3-stream] subscribed to wallet ${wallet.id}`);
    } catch (error) {
      console.error(
        `[web3-stream] failed to subscribe to wallet ${wallet.id}:`,
        error,
      );
    }
  }

  /**
   * Process a single transaction and extract metrics.
   */
  private async processTransaction(
    wallet: Entity,
    log: ethers.Log | ethers.EventLog,
  ): Promise<void> {
    try {
      const blockNumber = log.blockNumber;
      const block = await this.provider?.getBlock(blockNumber);

      if (!block) {
        console.warn(`[web3-stream] failed to fetch block ${blockNumber}`);
        return;
      }

      // Get transaction receipt to extract gas used and to_address
      const tx = await this.provider?.getTransaction(log.transactionHash);
      const receipt = await this.provider?.getTransactionReceipt(
        log.transactionHash,
      );

      if (!tx || !receipt) {
        console.warn(
          `[web3-stream] failed to fetch tx ${log.transactionHash}`,
        );
        return;
      }

      const ethPrice = await this.fetchEthPrice();
      const valueWei = BigInt(tx.value?.toString() ?? "0");
      const valueEth = Number(ethers.formatEther(valueWei));
      const valueUsd = valueEth * ethPrice;
      const gasUsed = Number(receipt.gasUsed);

      // Check if to_address is a contract
      const toAddress = tx.to;
      const isContractInteraction =
        toAddress !== null &&
        toAddress !== wallet.address &&
        (await this.isContractAddress(toAddress));

      const txDetails: TransactionDetails = {
        from_address: tx.from,
        to_address: toAddress,
        value_eth: valueEth,
        value_usd: valueUsd,
        gas_used: gasUsed,
        contract_interaction: isContractInteraction,
        timestamp: block.timestamp,
        tx_hash: log.transactionHash,
      };

      // Store raw event
      const inserted = await insertRawEventIfNew({
        entityId: wallet.id,
        eventType: "web3_transaction",
        source: "web3",
        eventTimestamp: new Date(txDetails.timestamp * 1000),
        payload: txDetails,
      });

      if (inserted) {
        // Update wallet's last_active_at
        await updateEntityLastActiveAt(wallet.id);

        // Check if wallet was dormant and is now activated
        await evaluateWeb3Dormancy(wallet.id);

        // Accumulate metrics for batching
        this.accumulateDailyMetrics(wallet.id, txDetails);

        console.log(
          `[web3-stream] new transaction from ${wallet.name}: ${valueEth} ETH`,
        );
      }
    } catch (error) {
      console.error("[web3-stream] transaction processing failed:", error);
    }
  }

  /**
   * Accumulate transaction metrics for the day.
   */
  private accumulateDailyMetrics(
    entityId: string,
    tx: TransactionDetails,
  ): void {
    const today = new Date().toISOString().split("T")[0];
    const key = `${entityId}:${today}`;

    let acc = this.dailyMetrics.get(key);
    if (!acc) {
      acc = {
        tx_count: 0,
        volume_usd: 0,
        unique_counterparties: new Set(),
        contracts_interacted: 0,
      };
      this.dailyMetrics.set(key, acc);
    }

    acc.tx_count += 1;
    acc.volume_usd += tx.value_usd;

    if (tx.to_address) {
      acc.unique_counterparties.add(tx.to_address.toLowerCase());
    }

    if (tx.contract_interaction) {
      acc.contracts_interacted += 1;
    }
  }

  /**
   * Flush accumulated daily metrics to the database.
   */
  private async flushDailyMetrics(): Promise<void> {
    if (this.dailyMetrics.size === 0) {
      return;
    }

    try {
      const metrics: Array<{
        entityId: string;
        metric: string;
        value: number;
        timestamp: Date;
      }> = [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const [key, acc] of this.dailyMetrics.entries()) {
        const [entityId] = key.split(":");

        metrics.push({
          entityId,
          metric: "tx_count_per_day",
          value: acc.tx_count,
          timestamp: today,
        });

        metrics.push({
          entityId,
          metric: "volume_usd_per_day",
          value: acc.volume_usd,
          timestamp: today,
        });

        metrics.push({
          entityId,
          metric: "unique_counterparties_per_day",
          value: acc.unique_counterparties.size,
          timestamp: today,
        });

        metrics.push({
          entityId,
          metric: "contracts_interacted_per_day",
          value: acc.contracts_interacted,
          timestamp: today,
        });
      }

      if (metrics.length > 0) {
        await insertEntityMetricsBatch(metrics);
        console.log(
          `[web3-stream] flushed ${metrics.length} metrics from ${this.dailyMetrics.size} wallets`,
        );
      }

      this.dailyMetrics.clear();
    } catch (error) {
      console.error("[web3-stream] failed to flush metrics:", error);
    }
  }

  /**
   * Fetch current ETH/USD price from CoinGecko with 1-minute cache.
   */
  private async fetchEthPrice(): Promise<number> {
    const now = Date.now();

    // Return cached price if less than 1 minute old
    if (
      this.ethPriceCache &&
      now - this.ethPriceCache.timestamp < 60 * 1000
    ) {
      return this.ethPriceCache.value;
    }

    try {
      const response = await fetch(COINGECKO_PRICE_URL);
      if (!response.ok) {
        console.warn(`[web3-stream] ETH price fetch failed: ${response.status}`);
        return this.ethPriceCache?.value ?? 2500; // Fallback
      }

      const data: unknown = await response.json();
      const price = extractEthPrice(data);

      this.ethPriceCache = { value: price, timestamp: now };
      return price;
    } catch (error) {
      console.warn("[web3-stream] ETH price fetch error:", error);
      return this.ethPriceCache?.value ?? 2500; // Fallback
    }
  }

  /**
   * Check if an address is a contract by calling eth_getCode.
   */
  private async isContractAddress(address: string): Promise<boolean> {
    try {
      const code = await this.provider?.getCode(address);
      return code !== "0x" && code !== undefined;
    } catch {
      return false;
    }
  }
}

/**
 * Extract ETH/USD price from CoinGecko API response.
 */
function extractEthPrice(data: unknown): number {
  if (
    typeof data === "object" &&
    data !== null &&
    "ethereum" in data &&
    typeof (data as Record<string, unknown>).ethereum === "object" &&
    (data as Record<string, unknown>).ethereum !== null &&
    "usd" in ((data as Record<string, unknown>).ethereum as Record<string, unknown>)
  ) {
    const price = ((data as Record<string, unknown>).ethereum as Record<string, unknown>)
      .usd;
    if (typeof price === "number") {
      return price;
    }
  }
  return 2500; // Fallback
}

/** Singleton instance of the transaction stream */
let streamInstance: Web3TransactionStream | null = null;

export async function startWeb3TransactionStream(
  wsUrl: string,
  apiKey: string | null,
): Promise<void> {
  if (streamInstance) {
    console.warn("[web3-stream] stream already running");
    return;
  }

  streamInstance = new Web3TransactionStream(wsUrl, apiKey);
  await streamInstance.start();
}

export async function stopWeb3TransactionStream(): Promise<void> {
  if (!streamInstance) {
    return;
  }

  await streamInstance.stop();
  streamInstance = null;
}
