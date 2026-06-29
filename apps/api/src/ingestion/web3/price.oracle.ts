import { ethers } from "ethers";
import { insertEntityMetricsBatch } from "../../repositories/ingestion.repository.js";
import {
  listLiquidityPoolEntities,
  listTokenEntities,
} from "../../repositories/web3.repository.js";
import { fetchEthPrice, normalizeAddress } from "./utils.js";

interface PoolData {
  reserveUsd: number;
  volumeUsd: number;
}

const UNISWAP_V2_SUBGRAPH =
  "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2";
const UNISWAP_V3_SUBGRAPH =
  "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";

const CHAINLINK_ABI = [
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
];

export class Web3PriceOraclePoller {
  private provider: ethers.WebSocketProvider | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private wsUrl: string, private apiKey: string | null) {}

  async start(): Promise<void> {
    if (!this.wsUrl) {
      console.warn("[web3-oracle] ALCHEMY_WS_URL not configured, skipping");
      return;
    }

    this.provider = new ethers.WebSocketProvider(this.wsUrl);
    this.provider.on("error", (error: Error) => {
      console.error("[web3-oracle] provider error:", error);
    });

    await this.poll();
    this.pollInterval = setInterval(() => {
      void this.poll();
    }, 60 * 1000);
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.provider) {
      await this.provider.destroy();
      this.provider = null;
    }
    console.log("[web3-oracle] stopped");
  }

  private async poll(): Promise<void> {
    if (!this.provider) {
      return;
    }

    try {
      const tokens = await listTokenEntities();
      const pools = await listLiquidityPoolEntities();
      const metrics: Array<{
        entityId: string;
        metric: string;
        value: number;
        timestamp: Date;
      }> = [];

      for (const token of tokens) {
        const tokenAddress = token.address;
        const chainlinkFeed = typeof token.config.chainlink_feed_address === "string"
          ? token.config.chainlink_feed_address
          : undefined;

        if (tokenAddress && chainlinkFeed) {
          const price = await this.fetchChainlinkPrice(chainlinkFeed);
          metrics.push({
            entityId: token.id,
            metric: "token_price_usd",
            value: price,
            timestamp: new Date(),
          });
        }

        if (tokenAddress) {
          const poolData = await this.fetchPoolDataForToken(tokenAddress);
          if (poolData) {
            metrics.push({
              entityId: token.id,
              metric: "pool_tvl_usd",
              value: poolData.reserveUsd,
              timestamp: new Date(),
            });
            metrics.push({
              entityId: token.id,
              metric: "pool_volume_usd",
              value: poolData.volumeUsd,
              timestamp: new Date(),
            });
          }
        }
      }

      for (const pool of pools) {
        if (!pool.address) {
          continue;
        }
        const poolData = await this.fetchPoolDataByAddress(pool.address);
        if (poolData) {
          metrics.push({
            entityId: pool.id,
            metric: "pool_tvl_usd",
            value: poolData.reserveUsd,
            timestamp: new Date(),
          });
          metrics.push({
            entityId: pool.id,
            metric: "pool_volume_usd",
            value: poolData.volumeUsd,
            timestamp: new Date(),
          });
        }
      }

      if (metrics.length > 0) {
        await insertEntityMetricsBatch(metrics);
        console.log("[web3-oracle] inserted", metrics.length, "price/oracle metrics");
      }
    } catch (error) {
      console.error("[web3-oracle] poll failed:", error);
    }
  }

  private async fetchChainlinkPrice(feedAddress: string): Promise<number> {
    if (!this.provider) {
      return 0;
    }
    try {
      const contract = new ethers.Contract(
        normalizeAddress(feedAddress),
        CHAINLINK_ABI,
        this.provider,
      ) as unknown as { latestRoundData: () => Promise<Record<string, unknown>> };
      const roundData = await contract.latestRoundData();
      const answer = BigInt((roundData.answer ?? 0n) as bigint);
      return Number(answer) / 1e8;
    } catch (error) {
      console.warn("[web3-oracle] chainlink price failed:", error);
      return 0;
    }
  }

  private async fetchPoolDataForToken(tokenAddress: string): Promise<PoolData | null> {
    const normalizedAddress = normalizeAddress(tokenAddress).toLowerCase();
    const queries = [
      this.queryUniswapV2TokenPools(normalizedAddress),
      this.queryUniswapV3TokenPools(normalizedAddress),
    ];
    const results = await Promise.all(queries);
    return results.find((result) => result !== null) ?? null;
  }

  private async fetchPoolDataByAddress(address: string): Promise<PoolData | null> {
    const normalizedAddress = normalizeAddress(address).toLowerCase();
    const v2 = await this.queryUniswapV2PairById(normalizedAddress);
    if (v2) {
      return v2;
    }
    return await this.queryUniswapV3PoolById(normalizedAddress);
  }

  private async queryUniswapV2TokenPools(token: string): Promise<PoolData | null> {
    const query = `query($token: Bytes!) { 
      pairs0: pairs(first: 1, where: { token0: $token }, orderBy: reserveUSD, orderDirection: desc) { id, reserveUSD, volumeUSD }
      pairs1: pairs(first: 1, where: { token1: $token }, orderBy: reserveUSD, orderDirection: desc) { id, reserveUSD, volumeUSD }
    }`;
    const result = await this.queryGraph(query, UNISWAP_V2_SUBGRAPH, { token });
    if (!result) {
      return null;
    }
    const candidates = [
      ...(result.pairs0 ?? []),
      ...(result.pairs1 ?? []),
    ];
    if (candidates.length === 0) {
      return null;
    }
    const best = candidates.reduce((prev, current) =>
      Number(current.reserveUSD) > Number(prev.reserveUSD) ? current : prev,
    );
    return {
      reserveUsd: Number(best.reserveUSD ?? 0),
      volumeUsd: Number(best.volumeUSD ?? 0),
    };
  }

  private async queryUniswapV3TokenPools(token: string): Promise<PoolData | null> {
    const query = `query($token: Bytes!) {
      pools0: pools(first: 1, where: { token0: $token }, orderBy: totalValueLockedUSD, orderDirection: desc) { id, totalValueLockedUSD, volumeUSD }
      pools1: pools(first: 1, where: { token1: $token }, orderBy: totalValueLockedUSD, orderDirection: desc) { id, totalValueLockedUSD, volumeUSD }
    }`;
    const result = await this.queryGraph(query, UNISWAP_V3_SUBGRAPH, { token });
    if (!result) {
      return null;
    }
    const candidates = [
      ...(result.pools0 ?? []),
      ...(result.pools1 ?? []),
    ];
    if (candidates.length === 0) {
      return null;
    }
    const best = candidates.reduce((prev, current) =>
      Number(current.totalValueLockedUSD) > Number(prev.totalValueLockedUSD) ? current : prev,
    );
    return {
      reserveUsd: Number(best.totalValueLockedUSD ?? 0),
      volumeUsd: Number(best.volumeUSD ?? 0),
    };
  }

  private async queryUniswapV2PairById(id: string): Promise<PoolData | null> {
    const query = `query($id: ID!) { pair(id: $id) { reserveUSD, volumeUSD } }`;
    const result = await this.queryGraph(query, UNISWAP_V2_SUBGRAPH, { id });
    if (result?.pair) {
      return {
        reserveUsd: Number(result.pair.reserveUSD ?? 0),
        volumeUsd: Number(result.pair.volumeUSD ?? 0),
      };
    }
    return null;
  }

  private async queryUniswapV3PoolById(id: string): Promise<PoolData | null> {
    const query = `query($id: ID!) { pool(id: $id) { totalValueLockedUSD, volumeUSD } }`;
    const result = await this.queryGraph(query, UNISWAP_V3_SUBGRAPH, { id });
    if (result?.pool) {
      return {
        reserveUsd: Number(result.pool.totalValueLockedUSD ?? 0),
        volumeUsd: Number(result.pool.volumeUSD ?? 0),
      };
    }
    return null;
  }

  private async queryGraph(query: string, endpoint: string, variables: Record<string, unknown>) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return data.data ?? null;
    } catch (error) {
      console.warn("[web3-oracle] graph query failed:", error);
      return null;
    }
  }
}

let oracleInstance: Web3PriceOraclePoller | null = null;

export async function startWeb3PriceOracleScheduler(
  wsUrl: string,
  apiKey: string | null,
): Promise<void> {
  if (oracleInstance) {
    console.warn("[web3-oracle] already running");
    return;
  }
  oracleInstance = new Web3PriceOraclePoller(wsUrl, apiKey);
  await oracleInstance.start();
}

export async function stopWeb3PriceOracleScheduler(): Promise<void> {
  if (!oracleInstance) {
    return;
  }
  await oracleInstance.stop();
  oracleInstance = null;
}
