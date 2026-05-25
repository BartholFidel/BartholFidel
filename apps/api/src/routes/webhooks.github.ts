import { Router, type Request, type Response } from "express";
import {
  handleGitHubWebhook,
  verifyGitHubSignature,
} from "../ingestion/web2/github.collector.js";

export const githubWebhookRouter = Router();

/**
 * POST /api/webhooks/github
 * Requires raw body (express.raw) for signature validation.
 */
githubWebhookRouter.post(
  "/github",
  async (req: Request, res: Response): Promise<void> => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      res.status(500).json({ success: false, error: "GITHUB_WEBHOOK_SECRET not configured" });
      return;
    }

    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ success: false, error: "Expected raw body buffer" });
      return;
    }

    const signature = req.headers["x-hub-signature-256"];
    const sigHeader = typeof signature === "string" ? signature : undefined;

    if (!verifyGitHubSignature(rawBody, sigHeader, secret)) {
      res.status(401).json({ success: false, error: "Invalid webhook signature" });
      return;
    }

    const eventType =
      typeof req.headers["x-github-event"] === "string"
        ? req.headers["x-github-event"]
        : "unknown";

    const deliveryId =
      typeof req.headers["x-github-delivery"] === "string"
        ? req.headers["x-github-delivery"]
        : "unknown";

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      res.status(400).json({ success: false, error: "Invalid JSON payload" });
      return;
    }

    try {
      const result = await handleGitHubWebhook({
        rawBody,
        eventType,
        deliveryId,
        payload,
      });
      res.status(202).json({ success: true, ...result });
    } catch (error) {
      console.error("[webhook/github] processing failed:", error);
      res.status(500).json({ success: false, error: "Webhook processing failed" });
    }
  },
);
