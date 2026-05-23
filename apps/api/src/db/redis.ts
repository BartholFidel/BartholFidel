import { Redis } from "ioredis";

let redisClient: Redis | null = null;

/** Returns the shared Redis client (lazy singleton). */
export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error("Redis client not initialized. Call connectRedis first.");
  }
  return redisClient;
}

/**
 * Connects to Redis and verifies connectivity with PING.
 */
export async function connectRedis(redisUrl: string): Promise<void> {
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await redisClient.connect();
  const pong = await redisClient.ping();
  if (pong !== "PONG") {
    throw new Error(`Unexpected Redis PING response: ${pong}`);
  }
}

/** Gracefully disconnects from Redis. */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
