import { ethers } from "ethers";
import type { Entity } from "@bartholfidel/shared";
import { insertEntityMetricsBatch, insertRawEventIfNew } from "../../repositories/ingestion.repository.js";
import { listContractWatchEntities } from "../../repositories/web3.repository.js";
import { evaluateWeb3ContractEventAttack } from "../../alerts/web3.patterns.js";
import { fetchEthPrice, normalizeAddress } from "./utils.js";

const CONTRACT_EVENT_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
  "event Sync(uint112 reserve0,uint112 reserve1)",
  "event Mint(address indexed sender,uint256 amount0,uint256 amount1)",
  "event Burn(address indexed sender,uint256 amount0,uint256 amount1,address indexed to)",
  "event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)",
];

export class Web3ContractEventDecoder {
  private provider: ethers.WebSocketProvider | null = null;
  private iface = new ethers.Interface(CONTRACT_EVENT_ABI);

  constructor(private wsUrl: string, private apiKey: string | null) {}

  async start(): Promise<void> {
    if (!this.wsUrl) {
      console.warn("[web3-decoder] ALCHEMY_WS_URL not configured, skipping");
      return;
    }

    this.provider = new ethers.WebSocketProvider(this.wsUrl);
    this.provider.on("error", (error: Error) => {
      console.error("[web3-decoder] provider error:", error);
    });

    const entities = await listContractWatchEntities();
    console.log(`[web3-decoder] subscribing to ${entities.length} contract watch addresses`);
    for (const entity of entities) {
      await this.subscribeToEntity(entity);
    }
  }

  async stop(): Promise<void> {
    if (this.provider) {
      this.provider.removeAllListeners();
      await this.provider.destroy();
      this.provider = null;
    }
    console.log("[web3-decoder] stopped");
  }

  private async subscribeToEntity(entity: Entity): Promise<void> {
    if (!this.provider || !entity.address) {
      return;
    }

    const target = normalizeAddress(entity.address);
    const listener = async (log: ethers.Log): Promise<void> => {
      await this.handleLog(entity, log);
    };

    this.provider.on({ address: target }, listener as any);
    console.log(`[web3-decoder] subscribed to contract ${entity.name} (${target})`);
  }

  private async handleLog(entity: Entity, log: ethers.Log): Promise<void> {
    if (!this.provider) {
      return;
    }

    try {
      const tx = await this.provider.getTransaction(log.transactionHash);
      const receipt = await this.provider.getTransactionReceipt(log.transactionHash);
      if (!tx || !receipt) {
        return;
      }

      const ethPrice = await fetchEthPrice();
      const valueWei = BigInt(tx.value ?? 0n);
      const valueEth = Number(ethers.formatEther(valueWei));
      const valueUsd = valueEth * ethPrice;
      const status = Number(receipt.status ?? 0n);

      let eventName = "unknown_event";
      let eventArgs: Record<string, unknown> = {};
      try {
        const parsed = this.iface.parseLog(log);
        if (parsed) {
          eventName = parsed.name;
          for (const [key, value] of Object.entries(parsed.args)) {
            if (Number.isNaN(Number(key))) {
              eventArgs[key] = value;
            }
          }
        }
      } catch {
        // ignore parse failures for unknown events
      }

      const payload = {
        contract: entity.address,
        event_name: eventName,
        args: eventArgs,
        tx_hash: log.transactionHash,
        from: tx.from,
        to: tx.to,
        value_usd: valueUsd,
        status,
      };

      const inserted = await insertRawEventIfNew({
        entityId: entity.id,
        eventType: "web3_contract_event",
        source: "web3",
        eventTimestamp: new Date(),
        payload,
      });

      if (!inserted) {
        return;
      }

      await insertEntityMetricsBatch([
        {
          entityId: entity.id,
          metric: "event_frequency_per_block",
          value: 1,
          timestamp: new Date(),
        },
        {
          entityId: entity.id,
          metric: "call_count_per_hour",
          value: 1,
          timestamp: new Date(),
        },
        {
          entityId: entity.id,
          metric: "value_in_usd_per_hour",
          value: valueUsd,
          timestamp: new Date(),
        },
        {
          entityId: entity.id,
          metric: "unique_callers_per_day",
          value: tx.from ? 1 : 0,
          timestamp: new Date(),
        },
        {
          entityId: entity.id,
          metric: "revert_rate",
          value: status === 0 ? 1 : 0,
          timestamp: new Date(),
        },
      ]);

      await evaluateWeb3ContractEventAttack(
        entity,
        eventName,
        valueUsd,
        log.transactionHash,
        tx.from,
        tx.to,
      );
    } catch (error) {
      console.error("[web3-decoder] failed to handle log:", error);
    }
  }
}

let decoderInstance: Web3ContractEventDecoder | null = null;

export async function startWeb3ContractEventDecoder(
  wsUrl: string,
  apiKey: string | null,
): Promise<void> {
  if (decoderInstance) {
    console.warn("[web3-decoder] already running");
    return;
  }
  decoderInstance = new Web3ContractEventDecoder(wsUrl, apiKey);
  await decoderInstance.start();
}

export async function stopWeb3ContractEventDecoder(): Promise<void> {
  if (!decoderInstance) {
    return;
  }
  await decoderInstance.stop();
  decoderInstance = null;
}
