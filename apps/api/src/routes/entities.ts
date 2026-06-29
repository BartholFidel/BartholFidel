import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  CreateEntityBody,
  Entity,
  EntityDetailResponse,
  EntitySource,
  EoaWalletConfig,
  GitHubRepoConfig,
  UpdateEntityBody,
} from "@bartholfidel/shared";
import { Router, type Request, type Response } from "express";
import { enqueueGitHubPollNow } from "../queues/github.queue.js";
import { enqueueNpmCollectorNow } from "../queues/npm.queue.js";
import { handleNewWeb3Wallet } from "../queues/web3.queue.js";
import { parseGitHubRepoName } from "../repositories/github.repository.js";
import {
  createEntity,
  deleteEntity,
  getEntityById,
  getEntityMetricsGrouped,
  listEntities,
  updateEntity,
} from "../repositories/entities.repository.js";

export const entitiesRouter = Router();

function isEntitySource(value: string): value is EntitySource {
  return value === "web2" || value === "web3";
}

function buildGitHubConfig(
  name: string,
  config: unknown,
): GitHubRepoConfig | null {
  const parsed = parseGitHubRepoName(name);
  if (!parsed) {
    return null;
  }
  const configRecord =
    typeof config === "object" && config !== null
      ? (config as Record<string, unknown>)
      : undefined;
  const watch_actions =
    typeof configRecord?.watch_actions === "boolean"
      ? configRecord.watch_actions
      : true;
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    watch_actions,
  };
}

function parseCreateBody(body: unknown): CreateEntityBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.name !== "string" ||
    typeof record.type !== "string" ||
    typeof record.source !== "string" ||
    !isEntitySource(record.source)
  ) {
    return null;
  }
  const config =
    record.config !== undefined &&
    typeof record.config === "object" &&
    record.config !== null
      ? (record.config as Record<string, unknown>)
      : undefined;

  const chain_id =
    typeof record.chain_id === "number" ? record.chain_id : undefined;
  const address =
    typeof record.address === "string"
      ? record.address.trim().toLowerCase()
      : undefined;

  return {
    name: record.name.trim(),
    type: record.type.trim(),
    source: record.source,
    config,
    chain_id,
    address,
  };
}

function parseUpdateBody(body: unknown): UpdateEntityBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;

  const updates: UpdateEntityBody = {};

  if (record.name !== undefined) {
    if (typeof record.name !== "string") {
      return null;
    }
    updates.name = record.name.trim();
  }

  if (record.chain_id !== undefined) {
    if (typeof record.chain_id !== "number") {
      return null;
    }
    updates.chain_id = record.chain_id;
  }

  if (record.address !== undefined) {
    if (record.address !== null && typeof record.address !== "string") {
      return null;
    }
    updates.address =
      typeof record.address === "string"
        ? record.address.trim().toLowerCase()
        : null;
  }

  if (record.config !== undefined) {
    if (typeof record.config !== "object" || record.config === null) {
      return null;
    }
    updates.config = record.config as Record<string, unknown>;
  }

  if (Object.keys(updates).length === 0) {
    return null;
  }

  return updates;
}

/** POST /api/entities — add entity to watchlist */
entitiesRouter.post(
  "/entities",
  async (req: Request, res: Response<ApiSuccessResponse<Entity> | ApiErrorResponse>) => {
    const body = parseCreateBody(req.body);
    if (!body || body.name.length === 0 || body.type.length === 0) {
      res.status(400).json({
        success: false,
        error: "Invalid body. Required: name, type, source (web2|web3).",
      });
      return;
    }

    if (body.type === "github_repo") {
      const ghConfig = buildGitHubConfig(body.name, body.config);
      if (!ghConfig) {
        res.status(400).json({
          success: false,
          error: 'GitHub repo name must be "owner/repo" (e.g. facebook/react).',
        });
        return;
      }
      body.config = ghConfig;
    }

    const isWeb3ContractType =
      body.type === "eoa_wallet" ||
      body.type === "smart_contract" ||
      body.type === "token" ||
      body.type === "liquidity_pool";

    if (isWeb3ContractType) {
      if (!body.address) {
        res.status(400).json({
          success: false,
          error: "Web3 watchlist entries require an address field (0x... format).",
        });
        return;
      }
      if (!/^0x[a-f0-9]{40}$/i.test(body.address)) {
        res.status(400).json({
          success: false,
          error: "Invalid Ethereum address format.",
        });
        return;
      }
      if (!body.chain_id) {
        res.status(400).json({
          success: false,
          error: "Web3 entities require chain_id (e.g. 1 for mainnet).",
        });
        return;
      }

      const configBase = {
        address: body.address,
        chain_id: body.chain_id,
      };

      const configRecord =
        typeof body.config === "object" && body.config !== null
          ? (body.config as Record<string, unknown>)
          : {};

      if (body.type === "token") {
        const symbol =
          typeof configRecord.symbol === "string"
            ? configRecord.symbol.trim()
            : undefined;
        const chainlinkFeed =
          typeof configRecord.chainlink_feed_address === "string"
            ? configRecord.chainlink_feed_address.trim().toLowerCase()
            : undefined;
        body.config = {
          ...configBase,
          ...(symbol ? { symbol } : {}),
          ...(chainlinkFeed ? { chainlink_feed_address: chainlinkFeed } : {}),
        };
      } else {
        body.config = configBase;
      }
    }

    try {
      const entity = await createEntity(body);
      if (body.type === "npm_package" && body.source === "web2") {
        await enqueueNpmCollectorNow();
      }
      if (body.type === "github_repo" && body.source === "web2") {
        await enqueueGitHubPollNow();
      }
      if (body.type === "eoa_wallet" && body.source === "web3") {
        handleNewWeb3Wallet(entity);
      }
      res.status(201).json({ success: true, data: entity });
    } catch (error) {
      console.error("[entities] create failed:", error);
      res.status(500).json({ success: false, error: "Failed to create entity" });
    }
  },
);

/** GET /api/entities — list entities with optional filters */
entitiesRouter.get(
  "/entities",
  async (req: Request, res: Response<ApiSuccessResponse<Entity[]> | ApiErrorResponse>) => {
    const source =
      typeof req.query.source === "string" ? req.query.source : undefined;
    const type =
      typeof req.query.type === "string" ? req.query.type : undefined;

    try {
      const entities = await listEntities({ source, type });
      res.json({ success: true, data: entities });
    } catch (error) {
      console.error("[entities] list failed:", error);
      res.status(500).json({ success: false, error: "Failed to list entities" });
    }
  },
);

/** GET /api/entities/:id — entity detail with recent metrics */
entitiesRouter.get(
  "/entities/:id",
  async (
    req: Request<{ id: string }>,
    res: Response<ApiSuccessResponse<EntityDetailResponse> | ApiErrorResponse>,
  ) => {
    try {
      const entity = await getEntityById(req.params.id);
      if (!entity) {
        res.status(404).json({ success: false, error: "Entity not found" });
        return;
      }
      const metrics = await getEntityMetricsGrouped(entity.id);
      res.json({ success: true, data: { entity, metrics } });
    } catch (error) {
      console.error("[entities] get failed:", error);
      res.status(500).json({ success: false, error: "Failed to fetch entity" });
    }
  },
);

/** PATCH /api/entities/:id — update entity fields */
entitiesRouter.patch(
  "/entities/:id",
  async (
    req: Request<{ id: string }>,
    res: Response<ApiSuccessResponse<Entity> | ApiErrorResponse>,
  ) => {
    const body = parseUpdateBody(req.body);
    if (!body) {
      res.status(400).json({
        success: false,
        error: "Invalid update payload. Provide at least one of name, address, chain_id, or config.",
      });
      return;
    }

    if (body.address !== undefined && body.address !== null) {
      if (!/^0x[a-f0-9]{40}$/i.test(body.address)) {
        res.status(400).json({
          success: false,
          error: "Invalid Ethereum address format.",
        });
        return;
      }
    }

    try {
      const existing = await getEntityById(req.params.id);
      if (!existing) {
        res.status(404).json({ success: false, error: "Entity not found" });
        return;
      }

      const updates: UpdateEntityBody = { ...body };
      if (
        existing.source === "web3" &&
        ["eoa_wallet", "smart_contract", "token", "liquidity_pool"].includes(
          existing.type,
        )
      ) {
        const mergedConfig = {
          ...(typeof existing.config === "object" && existing.config !== null
            ? existing.config
            : {}),
          ...(body.address !== undefined && body.address !== null
            ? { address: body.address }
            : {}),
          ...(body.chain_id !== undefined ? { chain_id: body.chain_id } : {}),
        } as Record<string, unknown>;
        updates.config = mergedConfig;
      }

      const entity = await updateEntity(req.params.id, updates);
      res.json({ success: true, data: entity });
    } catch (error) {
      console.error("[entities] update failed:", error);
      res.status(500).json({ success: false, error: "Failed to update entity" });
    }
  },
);

/** DELETE /api/entities/:id — remove from watchlist */
entitiesRouter.delete(
  "/entities/:id",
  async (
    req: Request<{ id: string }>,
    res: Response<ApiSuccessResponse<{ id: string }> | ApiErrorResponse>,
  ) => {
    try {
      const removed = await deleteEntity(req.params.id);
      if (!removed) {
        res.status(404).json({ success: false, error: "Entity not found" });
        return;
      }
      res.json({ success: true, data: { id: req.params.id } });
    } catch (error) {
      console.error("[entities] delete failed:", error);
      res.status(500).json({ success: false, error: "Failed to delete entity" });
    }
  },
);
