import type { Express, Request, Response } from "express";
import * as config from "../config.js";
import { log } from "../logger.js";

export function createDataRoutes(
  app: Express,
  deps: {
    database: any;
    sdkSession: any;
  }
): void {
  const { database, sdkSession } = deps;

  app.get("/api/history/:sessionId", (req: Request, res: Response) => {
    try {
      const messages = database.getConversationHistory(req.params.sessionId);
      const context = database.getSessionContext(req.params.sessionId);
      const isStreaming = sdkSession.isActive(req.params.sessionId);
      res.json({
        messages,
        streaming: isStreaming,
        streamingContent: isStreaming ? sdkSession.getStreamingContent(req.params.sessionId) : null,
        context_tokens: context?.input_tokens ?? null,
        model: context?.model ?? null,
      });
    } catch (err) {
      log.error("Failed to fetch history", { sessionId: req.params.sessionId, error: String(err) });
      res.status(500).json({ error: "Failed to load history" });
    }
  });

  app.get("/api/activity/:sessionId", (req: Request, res: Response) => {
    try {
      const events = database.getToolEvents(req.params.sessionId, config.getMaxActivityEvents());
      res.json({ events });
    } catch (err) {
      log.error("Failed to fetch activity", { sessionId: req.params.sessionId, error: String(err) });
      res.status(500).json({ error: "Failed to load activity" });
    }
  });

  app.get("/api/stats", (_req: Request, res: Response) => {
    try {
      res.json(database.getStats());
    } catch (err) {
      log.error("Failed to fetch stats", { error: String(err) });
      res.status(500).json({ error: "Failed to load stats" });
    }
  });

  app.get("/api/stats/user", (_req: Request, res: Response) => {
    try {
      res.json(database.getUserStats("local"));
    } catch (err) {
      log.error("Failed to fetch user stats", { userId: "local", error: String(err) });
      res.status(500).json({ error: "Failed to load user stats" });
    }
  });

  app.get("/api/insights", (req: Request, res: Response) => {
    let days = 30;
    try {
      days = parseInt(req.query.days as string ?? "30", 10);
      if (isNaN(days) || days < 1 || days > 365) days = 30;
      const project = (req.query.project as string) || undefined;
      const source = (req.query.source as string) || undefined;
      res.json(database.getInsights(days, project, source));
    } catch (err) {
      log.error("Failed to fetch insights", { days, error: String(err) });
      res.status(500).json({ error: "Failed to load insights" });
    }
  });

  // POST /api/import/sessions - Trigger historical session import
  app.post("/api/import/sessions", async (req: Request, res: Response) => {
    try {
      const { importSessions } = await import("../session-import.js");
      const result = importSessions();
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Import failed" });
    }
  });

  // GET /api/import/status - Get import statistics
  app.get("/api/import/status", (req: Request, res: Response) => {
    try {
      const status = database.getImportStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed to get import status" });
    }
  });

  app.get("/api/search", (req: Request, res: Response) => {
    try {
      const query = (req.query.q as string) || "";
      if (!query || query.trim().length === 0) {
        return res.json({ success: true, results: [] });
      }
      const limit = parseInt((req.query.limit as string) || "20", 10);
      const project = (req.query.project as string) || undefined;
      const results = database.searchConversations(query.trim(), project, limit);
      res.json({ success: true, results });
    } catch (err) {
      log.error("Failed to search conversations", { query: req.query.q, error: String(err) });
      res.status(500).json({ success: false, error: "Failed to search conversations" });
    }
  });
}
