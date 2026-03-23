import type { Express, Request, Response, Router } from "express";
import { getAllMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from "../mcp-config.js";
import { getWorkflowState, skipToPhase, type WorkflowPhase } from "../workflow-state.js";
import { WORKFLOW_ENABLED } from "../config.js";
import type { Server as SocketIOServer } from "socket.io";
import { fetchDiscoveredServers } from '../mcp-discovery.js';

// Exported for testing — prevents tests from duplicating (and potentially diverging from) production validation
export const SAFE_PACKAGE_NAME_RE = /^@?[a-zA-Z0-9][a-zA-Z0-9._\-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._\-]*)?$/;

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

  // -- MCP Discovery --

  app.get("/api/mcp/discover", async (req: Request, res: Response) => {
    try {
      const rawQuery = typeof req.query.query === 'string' ? req.query.query : '';
      const query = rawQuery.slice(0, 200);
      const rawOffset = parseInt(String(req.query.offset ?? '0'), 10);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : Math.min(rawOffset, 10_000);
      const result = await fetchDiscoveredServers(query, offset);
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: 'Discovery service unavailable' });
    }
  });

  app.post("/api/mcp/install", async (req: Request, res: Response) => {
    try {
      const { name, packageRegistry, packageName, sourceUrl, scope, projectPath } = req.body as {
        name?: string;
        packageRegistry?: string | null;
        packageName?: string | null;
        sourceUrl?: string | null;
        scope?: string;
        projectPath?: string;
      };

      if (!name || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
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

      if (packageName && !SAFE_PACKAGE_NAME_RE.test(packageName)) {
        res.status(400).json({ error: 'Invalid package name format' });
        return;
      }

      let config: McpServerConfig;
      if (packageRegistry === 'npm') {
        if (!packageName) {
          res.status(400).json({ error: 'packageName is required for npm registry' });
          return;
        }
        config = { command: 'npx', args: ['-y', packageName] };
      } else if (packageRegistry === 'pypi') {
        if (!packageName) {
          res.status(400).json({ error: 'packageName is required for pypi registry' });
          return;
        }
        config = { command: 'uvx', args: [packageName] };
      } else {
        res.status(400).json({
          error: 'Manual install required — no supported package registry',
          manualUrl: sourceUrl ?? null,
        });
        return;
      }

      addMcpServer(name.trim(), config, scope as 'user' | 'project', projectPath);
      res.status(201).json({ success: true, config });
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
