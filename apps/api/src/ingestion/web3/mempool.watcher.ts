import { ethers } from "ethers";
import type { Entity } from "@bartholfidel/shared";
import { insertRawEventIfNew } from "../../repositories/ingestion.repository.js";
import { listContractWatchEntities } from "../../repositories/web3.repository.js";
import { evaluateWeb3FlashLoanSignal, evaluateWeb3HighValuePendingTx } from "../../alerts/web3.patterns.js";
import { fetchEthPrice, normalizeAddress } from "./utils.js";

const LENDING_ABI = [
  "function borrow(address,uint256,uint256,uint16,address)",
  "function flashLoan(address,address,uint256,bytes)",
  "function flashLoan(address,address,address,uint256,bytes,uint16)",
];

export class Web3MempoolWatcher {
  private provider: ethers.WebSocketProvider | null = null;
  private addressIndex = new Map<string, Entity>();
  private seen = new Set<string>();
  private interface = new ethers.Interface(LENDING_ABI);

  constructor(private wsUrl: string, private apiKey: string | null) {}

  async start(): Promise<void> {
    if (!this.wsUrl) {
      console.warn("[web3-mempool] ALCHEMY_WS_URL not configured, skipping");
      return;
    }

    this.provider = new ethers.WebSocketProvider(this.wsUrl);
    this.provider.on("error", (error: Error) => {
      console.error("[web3-mempool] provider error:", error);
    });

    const entities = await listContractWatchEntities();
    for (const entity of entities) {
      if (entity.address) {
        this.addressIndex.set(normalizeAddress(entity.address).toLowerCase(), entity);
      }
    }

    // Every pending event requires fetching the full tx to learn its target, so
    // subscribing with no watched contracts means fetching the entire mainnet
    // mempool for nothing — which exhausts the RPC rate limit. Only subscribe
    // when there is at least one contract to match against.
    if (this.addressIndex.size === 0) {
      console.log(
        "[web3-mempool] no contract watch targets; skipping pending-tx subscription",
      );
      return;
    }

    this.provider.on("pending", (txHash: string) => {
      void this.handlePendingTx(txHash);
    });
    console.log(
      `[web3-mempool] watching pending transactions for ${this.addressIndex.size} contract target(s)`,
    );
  }

  async stop(): Promise<void> {
    if (this.provider) {
      this.provider.removeAllListeners("pending");
      await this.provider.destroy();
      this.provider = null;
    }
    this.addressIndex.clear();
    this.seen.clear();
    console.log("[web3-mempool] stopped");
  }

  private async handlePendingTx(txHash: string): Promise<void> {
    if (this.seen.has(txHash) || !this.provider) {
      return;
    }
    this.seen.add(txHash);

    try {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx || !tx.to) {
        return;
      }

      const target = normalizeAddress(tx.to).toLowerCase();
      const entity = this.addressIndex.get(target);
      if (!entity) {
        return;
      }

      const ethPrice = await fetchEthPrice();
      const valueUsd = Number(ethers.formatEther(BigInt(tx.value ?? 0n))) * ethPrice;

      if (valueUsd >= 50000) {
        const payload = {
          entity_id: entity.id,
          tx_hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value_usd: valueUsd,
          pending: true,
          data: tx.data,
        };
        await insertRawEventIfNew({
          entityId: entity.id,
          eventType: "web3_pending_high_value_tx",
          source: "web3",
          eventTimestamp: new Date(),
          payload,
        });
        await evaluateWeb3HighValuePendingTx(
          entity,
          tx.hash,
          valueUsd,
          tx.from,
          tx.to,
        );
      }

      const functionName = this.parseLendingFunction(tx.data);
      if (functionName) {
        await insertRawEventIfNew({
          entityId: entity.id,
          eventType: "web3_pre_attack_signal",
          source: "web3",
          eventTimestamp: new Date(),
          payload: {
            entity_id: entity.id,
            tx_hash: tx.hash,
            method: functionName,
            from: tx.from,
            to: tx.to,
            value_usd: valueUsd,
          },
        });
        await evaluateWeb3FlashLoanSignal(entity, tx.hash, functionName, valueUsd);
      }

      void this.provider.waitForTransaction(txHash, 1, 120000).then(async (receipt) => {
        if (!receipt) {
          return;
        }
        await insertRawEventIfNew({
          entityId: entity.id,
          eventType: receipt.status === 0 ? "web3_pending_tx_failed" : "web3_pending_tx_confirmed",
          source: "web3",
          eventTimestamp: new Date(),
          payload: {
            entity_id: entity.id,
            tx_hash: tx.hash,
            status: Number(receipt.status ?? 0n),
            confirmations: receipt.confirmations,
          },
        });
      });
    } catch (error) {
      console.error("[web3-mempool] pending tx handler failed:", error);
    }
  }

  private parseLendingFunction(data: string): string | null {
    if (!data || data === "0x" || data.length < 10) {
      return null;
    }
    try {
      const parsed = this.interface.parseTransaction({ data, value: 0n });
      if (parsed?.name === "borrow" || parsed?.name === "flashLoan") {
        return parsed.name;
      }
    } catch {
      // ignore parse errors
    }
    return null;
  }
}

let mempoolInstance: Web3MempoolWatcher | null = null;

export async function startWeb3MempoolWatcher(
  wsUrl: string,
  apiKey: string | null,
): Promise<void> {
  if (mempoolInstance) {
    console.warn("[web3-mempool] already running");
    return;
  }
  mempoolInstance = new Web3MempoolWatcher(wsUrl, apiKey);
  await mempoolInstance.start();
}

export async function stopWeb3MempoolWatcher(): Promise<void> {
  if (!mempoolInstance) {
    return;
  }
  await mempoolInstance.stop();
  mempoolInstance = null;
}
