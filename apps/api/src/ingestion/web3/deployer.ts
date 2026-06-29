import { ethers } from "ethers";
import { loadConfig } from "../../config.js";
import { normalizeAddress } from "./utils.js";

function rpcHttpUrl(): string | null {
  const config = loadConfig();
  const url = process.env.ALCHEMY_HTTP_URL ?? config.alchemyWsUrl;
  if (!url) {
    return null;
  }
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

interface EtherscanCreationResult {
  contractAddress: string;
  contractCreator: string;
  txHash: string;
}

/**
 * Resolves the address that deployed a contract.
 *
 * Prefers Etherscan's authoritative `getcontractcreation` when ETHERSCAN_API_KEY
 * is configured. Otherwise falls back to an Alchemy heuristic: the `from` of the
 * earliest external transfer into the contract. The heuristic is correct for
 * directly-deployed contracts but unreliable for factory/CREATE2 deployments
 * (where the creator appears as an internal call from the factory).
 *
 * Returns a checksummed address, or null when it cannot be determined.
 */
export async function resolveContractDeployer(
  address: string,
  chainId: number,
): Promise<string | null> {
  const config = loadConfig();
  if (config.etherscanApiKey) {
    const viaEtherscan = await resolveViaEtherscan(
      address,
      chainId,
      config.etherscanApiKey,
    );
    if (viaEtherscan) {
      return viaEtherscan;
    }
  }
  return resolveViaAlchemy(address);
}

async function resolveViaEtherscan(
  address: string,
  chainId: number,
  apiKey: string,
): Promise<string | null> {
  const url =
    `https://api.etherscan.io/v2/api?chainid=${chainId}` +
    `&module=contract&action=getcontractcreation` +
    `&contractaddresses=${address}&apikey=${apiKey}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(
        `[web3-deployer] etherscan HTTP ${response.status} for ${address}`,
      );
      return null;
    }
    const data = (await response.json()) as {
      status?: string;
      result?: EtherscanCreationResult[] | string;
    };
    if (!Array.isArray(data.result) || data.result.length === 0) {
      return null;
    }
    const creator = data.result[0]?.contractCreator;
    return creator ? normalizeAddress(creator) : null;
  } catch (error) {
    console.warn(`[web3-deployer] etherscan lookup failed for ${address}:`, error);
    return null;
  }
}

async function resolveViaAlchemy(address: string): Promise<string | null> {
  const httpUrl = rpcHttpUrl();
  if (!httpUrl) {
    return null;
  }
  try {
    const provider = new ethers.JsonRpcProvider(httpUrl);
    const response = (await provider.send("alchemy_getAssetTransfers", [
      {
        toAddress: address,
        category: ["external"],
        order: "asc",
        maxCount: "0x1",
        withMetadata: false,
        excludeZeroValue: false,
      },
    ])) as { transfers?: Array<{ from?: string | null }> };

    const from = response.transfers?.[0]?.from;
    return from ? normalizeAddress(from) : null;
  } catch (error) {
    console.warn(`[web3-deployer] alchemy lookup failed for ${address}:`, error);
    return null;
  }
}
