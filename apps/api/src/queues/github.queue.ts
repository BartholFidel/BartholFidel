import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { runGitHubPoller } from "../ingestion/web2/github.collector.js";

export const GITHUB_POLLER_QUEUE = "github-poller";
export const GITHUB_POLLER_JOB = "poll-github-repos";

/** 1-hour interval per Week 4 spec */
const POLL_INTERVAL_MS = 60 * 60 * 1000;

let githubQueue: Queue | null = null;
let githubWorker: Worker | null = null;

function getConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl, maxRetriesPerRequest: null };
}

export async function startGitHubPollerScheduler(
  redisUrl: string,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("[github-queue] GITHUB_TOKEN not set — poller disabled");
    return;
  }

  const connection = getConnection(redisUrl);

  githubQueue = new Queue(GITHUB_POLLER_QUEUE, { connection });

  githubWorker = new Worker(
    GITHUB_POLLER_QUEUE,
    async () => {
      await runGitHubPoller(token);
    },
    { connection },
  );

  githubWorker.on("failed", (job, error) => {
    console.error(`[github-queue] job ${job?.id ?? "unknown"} failed:`, error);
  });

  const existing = await githubQueue.getRepeatableJobs();
  for (const job of existing) {
    await githubQueue.removeRepeatableByKey(job.key);
  }

  await githubQueue.add(
    GITHUB_POLLER_JOB,
    {},
    {
      repeat: { every: POLL_INTERVAL_MS },
      removeOnComplete: 50,
      removeOnFail: 25,
    },
  );

  console.log(
    `[github-queue] scheduler started (every ${POLL_INTERVAL_MS / 3600000}h)`,
  );
}

export async function enqueueGitHubPollNow(): Promise<void> {
  if (!githubQueue) {
    return;
  }
  await githubQueue.add(GITHUB_POLLER_JOB, {}, {
    jobId: `github-poll-now-${Date.now()}`,
  });
}

export async function stopGitHubPollerScheduler(): Promise<void> {
  if (githubWorker) {
    await githubWorker.close();
    githubWorker = null;
  }
  if (githubQueue) {
    await githubQueue.close();
    githubQueue = null;
  }
}
