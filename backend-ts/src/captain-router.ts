/**
 * captain-router.ts
 *
 * Express router for Captain HTTP API endpoints.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { log } from './logger.js';

// ---- Types ----

interface CaptainRouterDependencies {
  readonly getCaptainSessionId: () => string | null;
  readonly isCaptainAlive: () => boolean;
  readonly getCaptainStatus: () => {
    active: boolean;
    sessionId: string | null;
    uptimeMs: number;
    messageCount: number;
  };
  readonly sendCaptainMessage: (content: string, source: string, sourceId: string) => void;
  readonly startCaptainSession: (workspace: string) => Promise<{ sessionId: string }>;
  readonly workspace: string;
}

// ---- Validation Schemas ----

const messageSchema = z.object({
  content: z.string().min(1).max(10000),
  source: z.enum(['web', 'telegram', 'discord', 'api']),
  source_id: z.string(),
});

// ---- Router Factory ----

export function createCaptainRouter(deps: CaptainRouterDependencies): Router {
  const router = Router();

  // POST /api/captain/start - Start Captain session (idempotent)
  router.post("/start", async (req: Request, res: Response) => {
    try {
      const result = await deps.startCaptainSession(deps.workspace);
      res.json({
        success: true,
        session_id: result.sessionId,
      });
    } catch (error) {
      log.error('Failed to start Captain session', { error: String(error) });
      res.status(500).json({
        success: false,
        error: String(error),
      });
    }
  });

  // GET /api/captain/status - Get Captain status
  router.get("/status", (req: Request, res: Response) => {
    const status = deps.getCaptainStatus();
    res.json(status);
  });

  // POST /api/captain/message - Send message to Captain
  router.post("/message", (req: Request, res: Response) => {
    try {
      const validated = messageSchema.parse(req.body);

      if (!deps.isCaptainAlive()) {
        res.status(503).json({
          success: false,
          error: "Captain is not alive",
        });
        return;
      }

      deps.sendCaptainMessage(validated.content, validated.source, validated.source_id);

      res.status(202).json({
        success: true,
        message: "Message queued for Captain",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "Validation error",
          details: error.issues,
        });
        return;
      }

      log.error('Failed to send Captain message', { error: String(error) });
      res.status(500).json({
        success: false,
        error: String(error),
      });
    }
  });

  return router;
}
