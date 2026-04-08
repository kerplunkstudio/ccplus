import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { isGitRepo, isGitWorktree, getGitDiff, getCommitDiff, getBranchDiff, getRangeDiff, parseUnifiedDiff, commitChanges, discardChanges } from '../git-operations.js';
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
   * Derive the main git repo root from a worktree path.
   * Worktrees are at <repo>/.claude/worktrees/<name>, so strip that suffix.
   * Falls back to the worktree path itself if the pattern does not match.
   */
  function deriveMainRepoPath(worktreePath: string): string {
    const worktreesMarker = path.join('.claude', 'worktrees');
    const idx = worktreePath.indexOf(worktreesMarker);
    if (idx === -1) {
      return worktreePath;
    }
    return worktreePath.slice(0, idx).replace(/\/$/, '');
  }

  /**
   * GET /api/sessions/:sessionId/diff
   * Get git diff scoped to this session's changes.
   *
   * Priority order:
   * 1. Stored diff_snapshot (most reliable for completed sessions)
   * 2. Live range diff using base_commit_hash (workspace exists)
   * 3. Fallback to uncommitted changes (getGitDiff)
   * 4. Fallback to branch diff (getBranchDiff)
   * 5. Range diff using base_commit_hash + merge_commit_hash (workspace gone)
   * 6. Commit diff using merge_commit_hash only
   * 7. Empty result
   */
  app.get('/api/sessions/:sessionId/diff', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const workspace = getWorkspace(sessionId);

      if (!workspace) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      // Try to get fleet session data for stored hashes/snapshot
      let fleetSession: ReturnType<typeof getFleetSession> = null;
      try {
        fleetSession = getFleetSession(sessionId);
      } catch {
        // DB lookup failed — continue without fleet session data
      }

      // CASE 1: Stored diff snapshot (most reliable for completed sessions)
      if (fleetSession?.diffSnapshot) {
        const files = parseUnifiedDiff(fleetSession.diffSnapshot);
        const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
        const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
        return res.json({ success: true, data: { files, totalAdditions, totalDeletions } });
      }

      const workspaceExists = fs.existsSync(workspace);
      const baseHash = fleetSession?.baseCommitHash;

      // CASE 2: Workspace exists — compute live diff
      if (workspaceExists && isGitRepo(workspace)) {
        // If we have a base hash, use range diff for precise scoping.
        // This is authoritative: if empty, the session made no changes.
        if (baseHash) {
          const rangeDiff = getRangeDiff(workspace, baseHash);
          return res.json({ success: true, data: rangeDiff });
        }

        // No base hash (old session). Unscoped fallbacks only make sense
        // in worktrees where git state is naturally isolated to this session.
        // On the main repo, getGitDiff/getBranchDiff would show unrelated changes.
        if (isGitWorktree(workspace)) {
          const diff = getGitDiff(workspace);
          if (diff.error) {
            return res.json({ success: false, error: diff.error });
          }
          if (diff.files.length > 0) {
            return res.json({ success: true, data: diff });
          }

          const branchDiff = getBranchDiff(workspace);
          if (!branchDiff.error && branchDiff.files.length > 0) {
            return res.json({ success: true, data: branchDiff });
          }
        }

        return res.json({ success: true, data: { files: [], totalAdditions: 0, totalDeletions: 0 } });
      }

      // CASE 3: Workspace gone — try merge commit hash with optional base hash range
      if (fleetSession?.mergeCommitHash) {
        const mainRepoPath = deriveMainRepoPath(workspace);
        if (fs.existsSync(mainRepoPath) && isGitRepo(mainRepoPath)) {
          if (baseHash) {
            const rangeDiff = getRangeDiff(mainRepoPath, baseHash, fleetSession.mergeCommitHash);
            if (rangeDiff.files.length > 0) {
              return res.json({ success: true, data: rangeDiff });
            }
          }
          const commitDiff = getCommitDiff(mainRepoPath, fleetSession.mergeCommitHash);
          return res.json({ success: true, data: commitDiff });
        }
      }

      // No data available
      return res.json({
        success: true,
        data: { files: [], totalAdditions: 0, totalDeletions: 0 }
      });
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
