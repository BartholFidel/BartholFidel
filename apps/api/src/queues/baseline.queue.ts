import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { runBaselineCalculator } from "../baseline/calculator.js";

export const BASELINE_QUEUE = "baseline-calculator";
export const BASELINE_JOB = "compute-baselines";

/** 6-hour interval per Week 3 spec */
const BASELINE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let baselineQueue: Queue | null = null;
let baselineWorker: Worker | null = null;

function getConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl, maxRetriesPerRequest: null };
}

export async function startBaselineScheduler(redisUrl: string): Promise<void> {
  const connection = getConnection(redisUrl);

  baselineQueue = new Queue(BASELINE_QUEUE, { connection });

  baselineWorker = new Worker(
    BASELINE_QUEUE,
    async () => {
      await runBaselineCalculator();
    },
    { connection },
  );

  baselineWorker.on("failed", (job, error) => {
    console.error(
      `[baseline-queue] job ${job?.id ?? "unknown"} failed:`,
      error,
    );
  });

  const existing = await baselineQueue.getRepeatableJobs();
  for (const job of existing) {
    await baselineQueue.removeRepeatableByKey(job.key);
  }

  await baselineQueue.add(
    BASELINE_JOB,
    {},
    {
      repeat: { every: BASELINE_INTERVAL_MS },
      removeOnComplete: 50,
      removeOnFail: 25,
    },
  );

  // Initial run so baselines exist without waiting 6 hours
  await baselineQueue.add(BASELINE_JOB, {}, { jobId: `baseline-bootstrap-${Date.now()}` });

  console.log(
    `[baseline-queue] scheduler started (every ${BASELINE_INTERVAL_MS / 3600000}h)`,
  );
}

export async function stopBaselineScheduler(): Promise<void> {
  if (baselineWorker) {
    await baselineWorker.close();
    baselineWorker = null;
  }
  if (baselineQueue) {
    await baselineQueue.close();
    baselineQueue = null;
  }
}
