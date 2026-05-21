import type { HealthCheckResponse } from "@bartholfidel/shared";
import { Router, type Request, type Response } from "express";

export const healthRouter = Router();

/**
 * GET /api/health — platform liveness and identity.
 */
healthRouter.get("/health", (_req: Request, res: Response) => {
  const body: HealthCheckResponse = {
    success: true,
    platform: "BartholFidel",
    status: "online",
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});
