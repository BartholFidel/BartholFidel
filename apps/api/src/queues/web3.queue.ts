import {
  startWeb3TransactionStream,
  stopWeb3TransactionStream,
} from "../ingestion/web3/transaction.stream.js";

/**
 * Manages the Web3 transaction stream lifecycle.
 * Unlike npm/github collectors that run on intervals,
 * the Web3 stream runs continuously once started.
 */
let streamStarted = false;

/**
 * Start the Web3 transaction stream.
 * This establishes a WebSocket connection to Alchemy and begins
 * monitoring all configured EOA wallet entities.
 */
export async function startWeb3StreamScheduler(
  wsUrl: string,
  apiKey: string | null,
): Promise<void> {
  if (streamStarted) {
    console.warn("[web3-queue] stream already running");
    return;
  }

  try {
    await startWeb3TransactionStream(wsUrl, apiKey);
    streamStarted = true;
    console.log("[web3-queue] Web3 transaction stream started");
  } catch (error) {
    console.error("[web3-queue] failed to start stream:", error);
    streamStarted = false;
    throw error;
  }
}

/**
 * Stop the Web3 transaction stream and clean up resources.
 */
export async function stopWeb3StreamScheduler(): Promise<void> {
  if (!streamStarted) {
    return;
  }

  try {
    await stopWeb3TransactionStream();
    streamStarted = false;
    console.log("[web3-queue] Web3 transaction stream stopped");
  } catch (error) {
    console.error("[web3-queue] error stopping stream:", error);
  }
}

/**
 * Check if the stream is currently running.
 */
export function isWeb3StreamRunning(): boolean {
  return streamStarted;
}
