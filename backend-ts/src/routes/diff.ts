import type { Express, Request, Response } from 'express';
import { isGitRepo, getGitDiff, commitChanges, discardChanges } from '../git-operations.js';

export function createDiffRoutes(
  app: Express,
  deps: {
    sessionWorkspaces: Map<string, string>;
    sdkSession: any;
    log: any;
  }
): void {
  const { sessionWorkspaces, sdkSession, log } = deps;

  /**
   * Helper: Look up workspace for a session
   */
  function getWorkspace(sessionId: string): string | null {
    // First check sessionWorkspaces map
    if (sessionWorkspaces.has(sessionId)) {
      return sessionWorkspaces.get(sessionId)!;
    }

    // Fallback: check active sessions via sdkSession
    const activeSessions = sdkSession.getActiveSessions?.() ?? [];
    const activeSession = activeSessions.find((s: any) => s.sessionId === sessionId);
    if (activeSession?.workspace) {
      return activeSession.workspace;
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
