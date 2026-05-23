import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { runNpmCollector } from "../ingestion/web2/npm.collector.js";

export const NPM_COLLECTOR_QUEUE = "npm-collector";
export const NPM_COLLECTOR_JOB = "poll-npm-rss";

/** 5-minute interval per Week 2 spec */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

let npmQueue: Queue | null = null;
let npmWorker: Worker | null = null;

function getConnection(redisUrl: string): ConnectionOptions {
  // BullMQ requires maxRetriesPerRequest: null on ioredis-backed connections
  return { url: redisUrl, maxRetriesPerRequest: null };
}

/**
 * Registers the BullMQ worker and repeatable RSS poll job.
 */
export async function startNpmCollectorScheduler(
  redisUrl: string,
): Promise<void> {
  const connection = getConnection(redisUrl);

  npmQueue = new Queue(NPM_COLLECTOR_QUEUE, { connection });

  npmWorker = new Worker(
    NPM_COLLECTOR_QUEUE,
    async () => {
      await runNpmCollector();
    },
    { connection },
  );

  npmWorker.on("failed", (job, error) => {
    console.error(`[npm-queue] job ${job?.id ?? "unknown"} failed:`, error);
  });

  npmWorker.on("completed", (job) => {
    console.log(`[npm-queue] job ${job.id} completed`);
  });

  // Clear stale repeatable jobs from prior dev restarts
  const existing = await npmQueue.getRepeatableJobs();
  for (const job of existing) {
    await npmQueue.removeRepeatableByKey(job.key);
  }

  // Repeatable job: poll npm RSS every 5 minutes
  await npmQueue.add(
    NPM_COLLECTOR_JOB,
    {},
    {
      repeat: { every: POLL_INTERVAL_MS },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  );

  console.log(
    `[npm-queue] scheduler started (every ${POLL_INTERVAL_MS / 1000}s)`,
  );
}

/** Enqueue an immediate collector run (e.g. after adding an npm watchlist entity). */
export async function enqueueNpmCollectorNow(): Promise<void> {
  if (!npmQueue) {
    return;
  }
  await npmQueue.add(NPM_COLLECTOR_JOB, {}, {
    jobId: `npm-collect-now-${Date.now()}`,
  });

}

export async function stopNpmCollectorScheduler(): Promise<void> {
  if (npmWorker) {
    await npmWorker.close();
    npmWorker = null;
  }
  if (npmQueue) {
    await npmQueue.close();
    npmQueue = null;
  }
}
