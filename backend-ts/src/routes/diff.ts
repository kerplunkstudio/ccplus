import type { Express, Request, Response } from 'express';
import { isGitRepo, getGitDiff, commitChanges, discardChanges } from '../git-operations.js';
import { getFleetSession } from '../db/fleet-sessions.js';
import type { RouteDependencies } from "./types.js";

export function createDiffRoutes(app: Express, deps: RouteDependencies): void {
  const { sessionWorkspaces, sdkSession, log } = deps;
  if (!sessionWorkspaces || !sdkSession || !log) throw new Error("Missing required dependencies");

  // Create local non-null references for closure capture
  const workspaceMap = sessionWorkspaces;
  const sessionManager = sdkSession;

  /**
   * Helper: Look up workspace for a session
   */
  function getWorkspace(sessionId: string): string | null {
    // First check in-memory sessionWorkspaces map
    if (workspaceMap.has(sessionId)) {
      return workspaceMap.get(sessionId)!;
    }

    // Check active sessions
    const activeSessions = sessionManager.getActiveSessions?.() ?? [];
    const activeSession = activeSessions.find((s: any) => s.sessionId === sessionId);
    if (activeSession?.workspace) {
      return activeSession.workspace;
    }

    // Fallback: check fleet_sessions DB table
    try {
      const fleetSession = getFleetSession(sessionId);
      if (fleetSession?.workspace) {
        return fleetSession.workspace;
      }
    } catch {
      // DB lookup failed, continue
    }

    return null;
  }

  /**
   * GET /api/sessions/:sessionId/diff
   * Get git diff for the session's workspace
   */
  app.get('/api/sessions/:sessionId/diff', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const workspace = getWorkspace(sessionId);

      if (!workspace) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      if (!isGitRepo(workspace)) {
        return res.json({
          success: true,
          data: {
            files: [],
            totalAdditions: 0,
            totalDeletions: 0
          }
        });
      }

      const diff = getGitDiff(workspace);

      if (diff.error) {
        return res.json({ success: false, error: diff.error });
      }

      return res.json({ success: true, data: diff });
    } catch (error) {
      log.error('Failed to get diff', { sessionId: req.params.sessionId, error: String(error) });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  /**
   * POST /api/sessions/:sessionId/commit
   * Commit changes in the session's workspace
   */
  app.post('/api/sessions/:sessionId/commit', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { message } = req.body;

      // Validate message
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Commit message is required' });
      }

      const workspace = getWorkspace(sessionId);

      if (!workspace) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      const result = commitChanges(workspace, message);
      return res.json(result);
    } catch (error) {
      log.error('Failed to commit changes', { sessionId: req.params.sessionId, error: String(error) });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  /**
   * POST /api/sessions/:sessionId/discard
   * Discard all changes in the session's workspace
   */
  app.post('/api/sessions/:sessionId/discard', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const workspace = getWorkspace(sessionId);

      if (!workspace) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      if (!isGitRepo(workspace)) {
        return res.status(400).json({ success: false, error: 'Not a git repository' });
      }

      const result = discardChanges(workspace);
      return res.json(result);
    } catch (error) {
      log.error('Failed to discard changes', { sessionId: req.params.sessionId, error: String(error) });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
}
