import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  CreateRelationshipBody,
  EntityGraph,
  EntityRelationship,
  ShortestPathResponse,
} from "@bartholfidel/shared";
import { Router, type Request, type Response } from "express";
import { getDriver, shortestPathEntityIds } from "../db/neo4j.js";
import {
  getEntitiesByIds,
  getEntityById,
} from "../repositories/entities.repository.js";
import {
  createRelationship,
  deleteRelationship,
  listGraph,
} from "../repositories/relationships.repository.js";

export const graphRouter = Router();

/** True when the Neo4j driver is connected. */
function neo4jAvailable(): boolean {
  try {
    getDriver();
    return true;
  } catch {
    return false;
  }
}

function parseCreateBody(body: unknown): CreateRelationshipBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.source_entity_id !== "string" ||
    typeof record.target_entity_id !== "string" ||
    typeof record.relationship_type !== "string" ||
    record.source_entity_id.length === 0 ||
    record.target_entity_id.length === 0 ||
    record.relationship_type.length === 0
  ) {
    return null;
  }
  return {
    source_entity_id: record.source_entity_id,
    target_entity_id: record.target_entity_id,
    relationship_type: record.relationship_type,
    confidence:
      typeof record.confidence === "number" ? record.confidence : undefined,
  };
}

/** GET /api/graph — nodes + edges for rendering (Postgres) */
graphRouter.get(
  "/graph",
  async (
    _req: Request,
    res: Response<ApiSuccessResponse<EntityGraph> | ApiErrorResponse>,
  ) => {
    try {
      const graph = await listGraph();
      res.json({ success: true, data: graph });
    } catch (error) {
      console.error("[graph] list failed:", error);
      res.status(500).json({ success: false, error: "Failed to load graph" });
    }
  },
);

/** GET /api/graph/path?from=&to= — shortest path between two entities (Neo4j) */
graphRouter.get(
  "/graph/path",
  async (
    req: Request,
    res: Response<ApiSuccessResponse<ShortestPathResponse> | ApiErrorResponse>,
  ) => {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!from || !to) {
      res
        .status(400)
        .json({ success: false, error: "Both 'from' and 'to' are required" });
      return;
    }
    if (!neo4jAvailable()) {
      res.status(503).json({
        success: false,
        error: "Graph traversal unavailable (Neo4j not connected)",
      });
      return;
    }

    try {
      const [fromEntity, toEntity] = await Promise.all([
        getEntityById(from),
        getEntityById(to),
      ]);
      if (!fromEntity || !toEntity) {
        res.status(404).json({ success: false, error: "Entity not found" });
        return;
      }

      const ids = await shortestPathEntityIds(from, to);
      const hydrated = await getEntitiesByIds(ids);
      const byId = new Map(hydrated.map((entity) => [entity.id, entity]));
      const path = ids
        .map((id) => byId.get(id))
        .filter((entity): entity is NonNullable<typeof entity> =>
          Boolean(entity),
        );

      res.json({
        success: true,
        data: { from, to, found: path.length > 0, path },
      });
    } catch (error) {
      console.error("[graph] path failed:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to compute shortest path" });
    }
  },
);

/** POST /api/graph/relationships — manually create a relationship */
graphRouter.post(
  "/graph/relationships",
  async (
    req: Request,
    res: Response<ApiSuccessResponse<EntityRelationship> | ApiErrorResponse>,
  ) => {
    const body = parseCreateBody(req.body);
    if (!body) {
      res.status(400).json({
        success: false,
        error:
          "Invalid body. Require source_entity_id, target_entity_id, relationship_type.",
      });
      return;
    }
    if (body.source_entity_id === body.target_entity_id) {
      res.status(400).json({
        success: false,
        error: "A relationship cannot connect an entity to itself",
      });
      return;
    }

    try {
      const [source, target] = await Promise.all([
        getEntityById(body.source_entity_id),
        getEntityById(body.target_entity_id),
      ]);
      if (!source || !target) {
        res.status(404).json({ success: false, error: "Entity not found" });
        return;
      }

      const relationship = await createRelationship({
        sourceEntityId: body.source_entity_id,
        targetEntityId: body.target_entity_id,
        relationshipType: body.relationship_type,
        confidence: body.confidence,
      });
      res.status(201).json({ success: true, data: relationship });
    } catch (error) {
      console.error("[graph] create relationship failed:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to create relationship" });
    }
  },
);

/** DELETE /api/graph/relationships/:id — remove a relationship */
graphRouter.delete(
  "/graph/relationships/:id",
  async (
    req: Request<{ id: string }>,
    res: Response<ApiSuccessResponse<{ id: string }> | ApiErrorResponse>,
  ) => {
    try {
      const removed = await deleteRelationship(req.params.id);
      if (!removed) {
        res
          .status(404)
          .json({ success: false, error: "Relationship not found" });
        return;
      }
      res.json({ success: true, data: { id: req.params.id } });
    } catch (error) {
      console.error("[graph] delete relationship failed:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to delete relationship" });
    }
  },
);
