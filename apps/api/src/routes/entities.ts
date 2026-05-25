import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  CreateEntityBody,
  Entity,
  EntityDetailResponse,
  EntitySource,
  EoaWalletConfig,
  GitHubRepoConfig,
} from "@bartholfidel/shared";
import { Router, type Request, type Response } from "express";
import { enqueueGitHubPollNow } from "../queues/github.queue.js";
import { enqueueNpmCollectorNow } from "../queues/npm.queue.js";
import { parseGitHubRepoName } from "../repositories/github.repository.js";
import {
  createEntity,
  deleteEntity,
  getEntityById,
  getEntityMetricsGrouped,
  listEntities,
} from "../repositories/entities.repository.js";

export const entitiesRouter = Router();

function isEntitySource(value: string): value is EntitySource {
  return value === "web2" || value === "web3";
}

function buildGitHubConfig(
  name: string,
  config: Record<string, unknown> | undefined,
): GitHubRepoConfig | null {
  const parsed = parseGitHubRepoName(name);
  if (!parsed) {
    return null;
  }
  const watch_actions =
    typeof config?.watch_actions === "boolean" ? config.watch_actions : true;
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

    if (body.type === "eoa_wallet") {
      if (!body.address) {
        res.status(400).json({
          success: false,
          error: "EOA wallet requires address field (0x... format).",
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
          error: "EOA wallet requires chain_id (e.g. 1 for mainnet).",
        });
        return;
      }
      body.config = {
        address: body.address,
        chain_id: body.chain_id,
      } as EoaWalletConfig;
    }

    try {
      const entity = await createEntity(body);
      if (body.type === "npm_package" && body.source === "web2") {
        await enqueueNpmCollectorNow();
      }
      if (body.type === "github_repo" && body.source === "web2") {
        await enqueueGitHubPollNow();
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
