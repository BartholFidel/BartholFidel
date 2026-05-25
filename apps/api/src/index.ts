import cors from "cors";
import express from "express";
import { loadConfig } from "./config.js";
import { connectPostgres, disconnectPostgres } from "./db/postgres.js";
import { connectRedis, disconnectRedis } from "./db/redis.js";
import {
  startBaselineScheduler,
  stopBaselineScheduler,
} from "./queues/baseline.queue.js";
import {
  startGitHubPollerScheduler,
  stopGitHubPollerScheduler,
} from "./queues/github.queue.js";
import { startNpmCollectorScheduler, stopNpmCollectorScheduler } from "./queues/npm.queue.js";
import {
  startWeb3StreamScheduler,
  stopWeb3StreamScheduler,
} from "./queues/web3.queue.js";
import { entitiesRouter } from "./routes/entities.js";
import { healthRouter } from "./routes/health.js";
import { incidentsRouter } from "./routes/incidents.js";
import { githubWebhookRouter } from "./routes/webhooks.github.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  await connectPostgres(config.databaseUrl);
  console.log("[api] PostgreSQL connected");

  await connectRedis(config.redisUrl);
  console.log("[api] Redis connected");

  await startNpmCollectorScheduler(config.redisUrl);
  console.log("[api] npm collector scheduler started");

  await startBaselineScheduler(config.redisUrl);
  console.log("[api] baseline scheduler started");

  await startGitHubPollerScheduler(config.redisUrl);
  console.log("[api] GitHub poller scheduler started");

  if (config.alchemyWsUrl) {
    await startWeb3StreamScheduler(config.alchemyWsUrl, config.alchemyApiKey);
    console.log("[api] Web3 transaction stream started");
  } else {
    console.warn("[api] ALCHEMY_WS_URL not configured, Web3 stream disabled");
  }

  const app = express();

  // GitHub webhooks require raw body for HMAC signature validation
  app.use(
    "/api/webhooks",
    express.raw({ type: "application/json" }),
    githubWebhookRouter,
  );

  app.use(cors());
  app.use(express.json());

  app.use("/api", healthRouter);
  app.use("/api", entitiesRouter);
  app.use("/api", incidentsRouter);

  const server = app.listen(config.apiPort, config.apiHost, () => {
    console.log(
      `[api] BartholFidel API listening on http://${config.apiHost}:${config.apiPort}`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[api] received ${signal}, shutting down`);
    server.close();
    await stopGitHubPollerScheduler();
    await stopBaselineScheduler();
    await stopNpmCollectorScheduler();
    await stopWeb3StreamScheduler();
    await disconnectRedis();
    await disconnectPostgres();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error: unknown) => {
  console.error("[api] startup failed:", error);
  process.exit(1);
});
