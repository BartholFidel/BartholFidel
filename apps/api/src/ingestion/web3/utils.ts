import { ethers } from "ethers";

export const COINGECKO_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

export async function fetchEthPrice(): Promise<number> {
  try {
    const response = await fetch(COINGECKO_PRICE_URL);
    if (!response.ok) {
      console.warn("[web3-utils] failed to fetch ETH price", response.status);
      return 2500;
    }
    const data: unknown = await response.json();
    return extractEthPrice(data);
  } catch (error) {
    console.warn("[web3-utils] ETH price fetch failed", error);
    return 2500;
  }
}

export function extractEthPrice(data: unknown): number {
  if (
    typeof data === "object" &&
    data !== null &&
    "ethereum" in data &&
    typeof (data as Record<string, unknown>).ethereum === "object" &&
    (data as Record<string, unknown>).ethereum !== null
  ) {
    const ethData = (data as Record<string, unknown>).ethereum as Record<string, unknown>;
    const usd = ethData.usd;
    if (typeof usd === "number") {
      return usd;
    }
  }
  return 2500;
}

export function normalizeAddress(address: string): string {
  try {
    return ethers.getAddress(address);
  } catch {
    return address.toLowerCase();
  }
}
