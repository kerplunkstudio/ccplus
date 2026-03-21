import type { Express, Request, Response } from "express";

export function createWorkspaceRoutes(
  app: Express,
  deps: {
    database: any;
  }
): void {
  const { database } = deps;

  app.get("/api/workspace", (_req: Request, res: Response) => {
    const state = database.getWorkspaceState("local");
    if (!state) {
      res.json({ projects: [], activeProjectPath: null });
      return;
    }
    res.json(state);
  });

  app.put("/api/workspace", (req: Request, res: Response) => {
    const state = req.body;
    if (!state || typeof state !== "object" || Object.keys(state).length === 0) {
      res.status(400).json({ error: "No state provided" });
      return;
    }
    database.saveWorkspaceState("local", state);
    res.json({ status: "ok" });
  });

  app.post("/api/workspace", (req: Request, res: Response) => {
    // POST variant for sendBeacon during page unload
    const state = req.body;
    if (!state || typeof state !== "object" || Object.keys(state).length === 0) {
      res.status(400).json({ error: "No state provided" });
      return;
    }
    database.saveWorkspaceState("local", state);
    res.json({ status: "ok" });
  });
}
