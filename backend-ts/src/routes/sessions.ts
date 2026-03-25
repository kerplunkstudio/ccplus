import type { Express, Request, Response } from "express";
import { log } from "../logger.js";
import { computeTrustScore } from "../trust-score.js";
import { startSession as startSessionApi } from "../session-api.js";
import * as fleetMonitor from "../fleet-monitor.js";
import type { RouteDependencies } from "./types.js";

export function createSessionRoutes(app: Express, deps: RouteDependencies): void {
  const { database, sdkSession, sessionWorkspaces, io, buildSocketCallbacks } = deps;
  if (!database || !sdkSession || !sessionWorkspaces || !io || !buildSocketCallbacks) {
    throw new Error("Missing required dependencies");
  }

  app.get("/api/sessions", (req: Request, res: Response) => {
    try {
      const project = (req.query.project as string) || undefined;
      res.json({ sessions: database.getSessionsList(50, project) });
    } catch (err) {
      log.error("Failed to list sessions", { error: String(err) });
      res.status(500).json({ error: "Failed to list sessions" });
    }
  });

  app.post("/api/sessions/:sessionId/archive", (req: Request, res: Response) => {
    try {
      const success = database.archiveSession(req.params.sessionId);
      if (success) {
        res.json({ status: "archived" });
      } else {
        res.status(500).json({ error: "Failed to archive session" });
      }
    } catch (err) {
      log.error("Failed to archive session", { sessionId: req.params.sessionId, error: String(err) });
      res.status(500).json({ error: "Failed to archive session" });
    }
  });

  app.get("/api/sessions/:sessionId/trust-score", (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      if (!sessionId) {
        return res.status(400).json({ success: false, error: "Session ID required" });
      }
      const { tools, queries, conversations } = database.getSessionTrustData(sessionId);
      if (tools.length === 0 && conversations.length === 0) {
        return res.status(404).json({ success: false, error: "Session not found or has no data" });
      }
      const trustMetrics = computeTrustScore(sessionId, tools, queries, conversations);
      return res.json({ success: true, data: trustMetrics });
    } catch (err) {
      log.error("Failed to compute trust score", { sessionId: req.params.sessionId, error: String(err) });
      return res.status(500).json({ success: false, error: "Failed to compute trust score" });
    }
  });

  app.post("/api/sessions/start", (req: Request, res: Response) => {
    try {
      const { prompt, workspace, model, session_id } = req.body;

      const result = startSessionApi(
        { prompt, workspace, model, sessionId: session_id },
        { database, sdkSession, sessionWorkspaces, io, buildSocketCallbacks, log }
      );

      if (result.success) {
        res.json({
          success: true,
          session_id: result.sessionId,
          message: 'Session started'
        });
      } else {
        const statusCode = result.error?.includes('within home directory') ? 403
          : result.error?.includes('already has an active query') ? 409
          : result.error?.includes('does not exist') ? 400
          : 400;
        res.status(statusCode).json({ success: false, error: result.error });
      }
    } catch (err) {
      log.error('Failed to start session', { error: String(err) });
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  app.post("/api/sessions/:id/resume", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ success: false, error: 'prompt is required' });
      }

      // Get session info from fleet monitor
      const sessionInfo = fleetMonitor.getSessionDetail(id);
      if (!sessionInfo) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      if (sdkSession.isActive(id)) {
        return res.status(409).json({ success: false, error: 'Session already has an active query' });
      }

      const callbacks = buildSocketCallbacks(id, sessionInfo.workspace);
      sdkSession.submitQuery(id, prompt, sessionInfo.workspace, callbacks);
      fleetMonitor.updateSessionStatus(id, 'running');

      res.json({
        success: true,
        session_id: id,
        message: 'Session resumed'
      });
    } catch (err) {
      log.error('Failed to resume session', { sessionId: req.params.id, error: String(err) });
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
}
