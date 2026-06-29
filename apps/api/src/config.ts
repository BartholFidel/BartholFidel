import path from "node:path";
import dotenv from "dotenv";

// Prefer monorepo root .env when running via npm workspaces (cwd is apps/api)
const rootEnv = path.resolve(process.cwd(), "../../.env");
const localEnv = path.resolve(process.cwd(), ".env");
dotenv.config({ path: rootEnv });
dotenv.config({ path: localEnv });

/** Application configuration loaded from environment variables. */
export interface AppConfig {
  apiPort: number;
  apiHost: string;
  databaseUrl: string;
  redisUrl: string;
  githubToken: string | null;
  githubWebhookSecret: string | null;
  alchemyApiKey: string | null;
  alchemyWsUrl: string | null;
  neo4jUri: string | null;
  neo4jUser: string | null;
  neo4jPassword: string | null;
  etherscanApiKey: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const portRaw = process.env.API_PORT ?? "4000";
  const apiPort = Number.parseInt(portRaw, 10);
  if (Number.isNaN(apiPort)) {
    throw new Error(`Invalid API_PORT: ${portRaw}`);
  }

  // NEO4J_AUTH is a single "user/password" pair (Neo4j convention).
  const neo4jAuth = process.env.NEO4J_AUTH ?? null;
  const slash = neo4jAuth ? neo4jAuth.indexOf("/") : -1;
  const neo4jUser =
    neo4jAuth && slash >= 0 ? neo4jAuth.slice(0, slash) : null;
  const neo4jPassword =
    neo4jAuth && slash >= 0 ? neo4jAuth.slice(slash + 1) : null;

  return {
    apiPort,
    apiHost: process.env.API_HOST ?? "0.0.0.0",
    databaseUrl: requireEnv("DATABASE_URL"),
    redisUrl: requireEnv("REDIS_URL"),
    githubToken: process.env.GITHUB_TOKEN ?? null,
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? null,
    alchemyApiKey: process.env.ALCHEMY_API_KEY ?? null,
    alchemyWsUrl: process.env.ALCHEMY_WS_URL ?? null,
    neo4jUri: process.env.NEO4J_URI ?? null,
    neo4jUser,
    neo4jPassword,
    etherscanApiKey: process.env.ETHERSCAN_API_KEY ?? null,
  };
}
