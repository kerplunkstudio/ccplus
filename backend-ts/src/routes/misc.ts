import type { Express, Request, Response, Router } from "express";
import { getAllMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from "../mcp-config.js";
import { getWorkflowState, skipToPhase, type WorkflowPhase } from "../workflow-state.js";
import { WORKFLOW_ENABLED } from "../config.js";
import type { Server as SocketIOServer } from "socket.io";

export function createMiscRoutes(
  app: Express,
  deps: {
    sdkSession: any;
    io: SocketIOServer;
    fleetMonitor: any;
    captainRouter: Router;
  }
): void {
  const { sdkSession, io, fleetMonitor, captainRouter } = deps;

  // -- Plugins (stub) --

  app.get("/api/plugins", (_req: Request, res: Response) => {
    res.json({ plugins: [] });
  });

  app.get("/api/plugins/marketplace", (_req: Request, res: Response) => {
    res.json({ plugins: [] });
  });

  app.get("/api/skills", (req: Request, res: Response) => {
    const projectPath = req.query.project as string | undefined;
    const skills = sdkSession.discoverSkills(projectPath);
    res.json({ skills });
  });

  // -- MCP Servers --

  app.get("/api/mcp/servers", (req: Request, res: Response) => {
    try {
      const projectPath = req.query.project as string | undefined;
      const servers = getAllMcpServers(projectPath);
      res.json({ servers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/mcp/servers", (req: Request, res: Response) => {
    try {
      const { name, config, scope, projectPath } = req.body;

      if (!name || !config) {
        res.status(400).json({ error: 'name and config are required' });
        return;
      }

      if (!scope || !['user', 'project'].includes(scope)) {
        res.status(400).json({ error: 'scope must be "user" or "project"' });
        return;
      }

      if (scope === 'project' && !projectPath) {
        res.status(400).json({ error: 'projectPath is required for project scope' });
        return;
      }

      addMcpServer(name, config as McpServerConfig, scope, projectPath);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/mcp/servers/:name", (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { scope, projectPath } = req.query as { scope?: string; projectPath?: string };

      if (!scope || !['user', 'project'].includes(scope)) {
        res.status(400).json({ error: 'scope query param must be "user" or "project"' });
        return;
      }

      const removed = removeMcpServer(name, scope as 'user' | 'project', projectPath);
      if (removed) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: `Server "${name}" not found in ${scope} scope` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // -- Workflow state --

  app.get("/api/workflow/:sessionId", (req: Request, res: Response) => {
    if (!WORKFLOW_ENABLED) {
      res.json({ enabled: false });
      return;
    }
    const state = getWorkflowState(req.params.sessionId);
    res.json({ enabled: true, ...state });
  });

  app.post("/api/workflow/:sessionId/transition", (req: Request, res: Response) => {
    if (!WORKFLOW_ENABLED) {
      res.status(400).json({ error: 'Workflow not enabled' });
      return;
    }
    const { phase } = req.body as { phase?: string };
    const validPhases: WorkflowPhase[] = ['idle', 'design', 'plan', 'execute', 'test', 'review', 'complete'];
    if (!phase || !validPhases.includes(phase as WorkflowPhase)) {
      res.status(400).json({ error: 'Invalid phase' });
      return;
    }
    const state = skipToPhase(req.params.sessionId, phase as WorkflowPhase);
    if (!state) {
      res.status(500).json({ error: 'Failed to update workflow state' });
      return;
    }
    io.to(req.params.sessionId).emit('workflow_phase', {
      phase: state.phase,
      previous: state.transitions.at(-1)?.from ?? 'idle',
      sessionId: req.params.sessionId,
    });
    res.json(state);
  });

  // -- Fleet State Endpoint --

  app.get('/api/fleet/state', (_req: Request, res: Response) => {
    const state = fleetMonitor.getFleetState();
    res.json(state);
  });

  // -- Captain Routes --

  app.use('/api/captain', captainRouter);
}
