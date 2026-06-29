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
import { fetchEthPrice } from "./utils.js";

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
  private watchList: Set<string> = new Set();
  private wallets: Entity[] = [];
  private dailyMetrics: Map<string, DailyMetricsAccumulator> = new Map();
  private metricsFlushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly receiptBatchSize = 5;
  private readonly rateLimitDelayMs = 1000;
  private readonly maxReceiptRetries = 4;

  constructor(
    private wsUrl: string,
    private apiKey: string | null,
  ) {}

  /**
   * Initialize the WebSocket provider and start streaming new blocks.
   */
  async start(): Promise<void> {
    if (!this.wsUrl) {
      console.warn("[web3-stream] ALCHEMY_WS_URL not configured, skipping");
      return;
    }

    this.provider = new ethers.WebSocketProvider(this.wsUrl);
    this.provider.on("error", (error: Error) => {
      console.error("[web3-stream] provider error:", error);
    });

    try {
      const currentBlock = await this.provider.getBlockNumber();
      console.log(
        `[web3-stream] connected to Alchemy websocket; current block ${currentBlock}`,
      );
    } catch (error) {
      console.error("[web3-stream] failed to connect to Alchemy websocket:", error);
      return;
    }

    const wallets = await listEoaWalletEntities();
    console.log(`[web3-stream] watching wallets: ${wallets.map(w => `${w.id}:${w.name}:${w.address}`).join(', ')}`);
    this.wallets = wallets.filter((wallet) => wallet.address);
    this.watchList = new Set(
      this.wallets.map((wallet) => wallet.address!.toLowerCase()),
    );
    console.log(`[web3-stream] watching ${this.watchList.size} EOA wallets`);

    this.provider.on("block", (blockNumber: number) => {
      void this.handleBlock(blockNumber);
    });

    this.metricsFlushInterval = setInterval(() => {
      void this.flushDailyMetrics();
    }, 5 * 60 * 1000);
  }

  async stop(): Promise<void> {
    if (this.metricsFlushInterval) {
      clearInterval(this.metricsFlushInterval);
    }
    await this.flushDailyMetrics();
    if (this.provider) {
      await this.provider.destroy();
      this.provider = null;
    }
    console.log("[web3-stream] stream stopped");
  }

  /**
   * Register a wallet with the running stream so its transactions are captured
   * live, without restarting the API. Safe to call repeatedly.
   */
  addWallet(entity: Entity): void {
    if (!entity.address) {
      return;
    }
    const address = entity.address.toLowerCase();
    if (this.watchList.has(address)) {
      return;
    }
    this.watchList.add(address);
    this.wallets.push(entity);
    console.log(
      `[web3-stream] now watching wallet ${entity.name} (${address}); ${this.watchList.size} total`,
    );
  }

  private async handleBlock(blockNumber: number): Promise<void> {
    if (!this.provider) {
      return;
    }
    const walletAddresses = this.watchList;
    const wallets = this.wallets;

    try {
      const block = await this.provider.getBlock(blockNumber, true);
      if (!block) {
        return;
      }

      const matchingTxs: Array<{
        wallet: Entity;
        tx: ethers.TransactionResponse;
      }> = [];

      for (const tx of block.transactions as unknown as ethers.TransactionResponse[]) {
        const from = tx.from?.toLowerCase() ?? "";
        const to = tx.to?.toLowerCase() ?? "";
        if (!walletAddresses.has(from) && !walletAddresses.has(to)) {
          continue;
        }

        const wallet = wallets.find(
          (entity) =>
            entity.address?.toLowerCase() === from ||
            entity.address?.toLowerCase() === to,
        );
        if (!wallet) {
          continue;
        }

        matchingTxs.push({ wallet, tx });
      }

      console.log(`[web3-stream] block ${blockNumber} matched ${matchingTxs.length} tx(s)`);
      if (matchingTxs.length > 0) {
        console.log(
          `[web3-stream] matched tx hashes: ${matchingTxs
            .map((m) => m.tx.hash)
            .slice(0, 10)
            .join(", ")}`,
        );
      }

      await this.processTransactionBatch(matchingTxs, block.timestamp);
      if (matchingTxs.length > 0) {
        await this.flushDailyMetrics();
      }
    } catch (error) {
      console.error("[web3-stream] block processing failed:", error);
    }
  }

  private async processTransactionBatch(
    transactions: Array<{ wallet: Entity; tx: ethers.TransactionResponse }>,
    blockTimestamp: number,
  ): Promise<void> {
    if (transactions.length === 0) {
      return;
    }

    for (let i = 0; i < transactions.length; i += this.receiptBatchSize) {
      const chunk = transactions.slice(i, i + this.receiptBatchSize);
      console.log(`[web3-stream] processing chunk ${i / this.receiptBatchSize + 1} with ${chunk.length} tx(s)`);

      await Promise.all(
        chunk.map(async ({ wallet, tx }) => {
          console.log(`[web3-stream] fetching receipt for ${tx.hash}`);
          const receipt = await this.getTransactionReceiptWithBackoff(tx.hash);
          if (!receipt) {
            console.warn(`[web3-stream] no receipt for ${tx.hash}, skipping`);
            return;
          }
          console.log(`[web3-stream] got receipt for ${tx.hash} (status=${receipt.status})`);
          await this.processTransactionWithReceipt(wallet, tx, blockTimestamp, receipt);
        }),
      );

      if (i + this.receiptBatchSize < transactions.length) {
        await this.delay(this.rateLimitDelayMs);
      }
    }
  }

  private async processTransactionWithReceipt(
    wallet: Entity,
    tx: ethers.TransactionResponse,
    blockTimestamp: number,
    receipt: ethers.TransactionReceipt,
  ): Promise<void> {
    try {
      const ethPrice = await fetchEthPrice();
      const valueEth = Number(ethers.formatEther(BigInt(tx.value ?? 0n)));
      const valueUsd = valueEth * ethPrice;
      const gasUsed = Number(receipt.gasUsed ?? 0n);
      const toAddress = tx.to ?? null;
      const isContractInteraction =
        toAddress !== null &&
        toAddress.toLowerCase() !== wallet.address?.toLowerCase() &&
        (await this.isContractAddress(toAddress));

      const txDetails: TransactionDetails = {
        from_address: tx.from,
        to_address: toAddress,
        value_eth: valueEth,
        value_usd: valueUsd,
        gas_used: gasUsed,
        contract_interaction: isContractInteraction,
        timestamp: Number(blockTimestamp),
        tx_hash: tx.hash,
      };

      const inserted = await insertRawEventIfNew({
        entityId: wallet.id,
        eventType: "web3_transaction",
        source: "web3",
        eventTimestamp: new Date(txDetails.timestamp * 1000),
        payload: txDetails,
      });

      console.log(`[web3-stream] insertRawEventIfNew returned ${inserted} for ${tx.hash} entity=${wallet.id}`);

      if (!inserted) {
        console.log(`[web3-stream] event already exists or insert failed for ${tx.hash}`);
        return;
      }

      await updateEntityLastActiveAt(wallet.id);
      await evaluateWeb3Dormancy(wallet.id);
      this.accumulateDailyMetrics(wallet.id, txDetails);
      console.log(
        `[web3-stream] transaction event for ${wallet.name}: ${valueEth} ETH`,
      );
    } catch (error) {
      console.error("[web3-stream] transaction processing failed:", error);
    }
  }

  private async getTransactionReceiptWithBackoff(
    hash: string,
  ): Promise<ethers.TransactionReceipt | null> {
    if (!this.provider) {
      return null;
    }

    let attempt = 0;
    let delayMs = this.rateLimitDelayMs;

    for (let attempt = 0; attempt < this.maxReceiptRetries; attempt++) {
      try {
        const receipt = await this.provider.getTransactionReceipt(hash);
        return receipt ?? null;
      } catch (error: unknown) {
        const err = error as { status?: number; statusCode?: number; message?: string };
        const is429 =
          err.status === 429 ||
          err.statusCode === 429 ||
          typeof err.message === "string" && err.message.includes("429");

        if (!is429 || attempt === this.maxReceiptRetries) {
          console.error(`[web3-stream] failed to fetch receipt for ${hash} after ${attempt + 1} attempts:`, error);
          return null;
        }

        attempt += 1;
        await this.delay(delayMs);
        delayMs *= 2;
      }
    }

    console.error(`[web3-stream] exhausted receipt retries for ${hash}`);
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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
        const entityId = key.split(":")[0] ?? "";

        if (!entityId) {
          continue;
        }

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
        try {
          console.log(`[web3-stream] prepared ${metrics.length} metric rows: ${metrics
            .slice(0, 20)
            .map((m) => `${m.entityId}:${m.metric}=${m.value}`)
            .join(", ")}`);
          await insertEntityMetricsBatch(metrics);
          console.log(
            `[web3-stream] flushed ${metrics.length} metrics from ${this.dailyMetrics.size} wallets`,
          );
        } catch (err) {
          console.error("[web3-stream] insertEntityMetricsBatch failed:", err);
        }
      }

      this.dailyMetrics.clear();
    } catch (error) {
      console.error("[web3-stream] failed to flush metrics:", error);
    }
  }

  private async isContractAddress(address: string): Promise<boolean> {
    try {
      const code = await this.provider?.getCode(address);
      return code !== "0x" && code !== undefined;
    } catch {
      return false;
    }
  }
}

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

/**
 * Register a wallet with the running transaction stream (if any). No-op when the
 * stream isn't started (e.g. Alchemy not configured).
 */
export function addWalletToStream(entity: Entity): void {
  streamInstance?.addWallet(entity);
}

export async function stopWeb3TransactionStream(): Promise<void> {
  if (!streamInstance) {
    return;
  }

  await streamInstance.stop();
  streamInstance = null;
}
