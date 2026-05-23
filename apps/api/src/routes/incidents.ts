import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  Incident,
  IncidentStatusAction,
  IncidentTierCounts,
  RawPayloadSummary,
} from "@bartholfidel/shared";
import { Router, type Request, type Response } from "express";
import {
  countActiveIncidentsByTier,
  getIncidentById,
  getLatestRawPayloadSummary,
  listIncidents,
  updateIncidentStatus,
} from "../repositories/incidents.repository.js";

export const incidentsRouter = Router();

function isStatusAction(value: string): value is IncidentStatusAction {
  return value === "confirm" || value === "false_positive";
}

/** GET /api/incidents — all incidents, newest first */
incidentsRouter.get(
  "/incidents",
  async (
    _req: Request,
    res: Response<ApiSuccessResponse<Incident[]> | ApiErrorResponse>,
  ) => {
    try {
      const incidents = await listIncidents();
      res.json({ success: true, data: incidents });
    } catch (error) {
      console.error("[incidents] list failed:", error);
      res.status(500).json({ success: false, error: "Failed to list incidents" });
    }
  },
);

/** GET /api/incidents/counts — open incidents by tier (dashboard) */
incidentsRouter.get(
  "/incidents/counts",
  async (
    _req: Request,
    res: Response<ApiSuccessResponse<IncidentTierCounts> | ApiErrorResponse>,
  ) => {
    try {
      const counts = await countActiveIncidentsByTier();
      res.json({ success: true, data: counts });
    } catch (error) {
      console.error("[incidents] counts failed:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch incident counts" });
    }
  },
);

/** GET /api/incidents/:id/payload — raw event summary for expanded row */
incidentsRouter.get(
  "/incidents/:id/payload",
  async (
    req: Request<{ id: string }>,
    res: Response<ApiSuccessResponse<RawPayloadSummary | null> | ApiErrorResponse>,
  ) => {
    try {
      const incident = await getIncidentById(req.params.id);
      if (!incident) {
        res.status(404).json({ success: false, error: "Incident not found" });
        return;
      }
      const summary = await getLatestRawPayloadSummary(incident.entity_id);
      res.json({ success: true, data: summary });
    } catch (error) {
      console.error("[incidents] payload failed:", error);
      res.status(500).json({ success: false, error: "Failed to fetch payload" });
    }
  },
);

/** PATCH /api/incidents/:id/status — Confirm or False Positive */
incidentsRouter.patch(
  "/incidents/:id/status",
  async (
    req: Request<{ id: string }, unknown, { action?: string }>,
    res: Response<ApiSuccessResponse<Incident> | ApiErrorResponse>,
  ) => {
    const action = req.body?.action;
    if (typeof action !== "string" || !isStatusAction(action)) {
      res.status(400).json({
        success: false,
        error: 'Invalid action. Use "confirm" or "false_positive".',
      });
      return;
    }

    try {
      const updated = await updateIncidentStatus(req.params.id, action);
      if (!updated) {
        res.status(404).json({ success: false, error: "Incident not found" });
        return;
      }
      const withName = await getIncidentById(updated.id);
      res.json({ success: true, data: withName ?? updated });
    } catch (error) {
      console.error("[incidents] status update failed:", error);
      res.status(500).json({ success: false, error: "Failed to update incident" });
    }
  },
);
