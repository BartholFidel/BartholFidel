import cors from "cors";
import express from "express";
import { loadConfig } from "./config.js";
import { connectPostgres, disconnectPostgres } from "./db/postgres.js";
import { connectRedis, disconnectRedis } from "./db/redis.js";
import { healthRouter } from "./routes/health.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  // Verify infrastructure connections before accepting traffic
  await connectPostgres(config.databaseUrl);
  console.log("[api] PostgreSQL connected");

  await connectRedis(config.redisUrl);
  console.log("[api] Redis connected");

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use("/api", healthRouter);

  const server = app.listen(config.apiPort, config.apiHost, () => {
    console.log(
      `[api] BartholFidel API listening on http://${config.apiHost}:${config.apiPort}`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[api] received ${signal}, shutting down`);
    server.close();
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
