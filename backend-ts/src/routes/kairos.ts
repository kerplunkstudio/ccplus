import { Router, type Request, type Response } from 'express';
import { log } from '../logger.js';
import {
  getAnalyses,
  getAnalysis,
  getCorrelationsForSession,
  getPromptChangeHistory,
  getActivePromptChanges,
  markPromptChangeRolledBack,
} from '../db/kairos.js';

const router = Router();

// GET /api/kairos/status - Get daemon state
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const { getKairosDaemonState } = await import('../kairos-daemon.js');
    const state = getKairosDaemonState();
    res.json({ success: true, data: state });
  } catch (error) {
    log.error('Failed to get KAIROS daemon state', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/kairos/analyses - List analyses
router.get('/analyses', (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const outcome = req.query.outcome as string | undefined;
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    if (limitStr && (isNaN(limit) || limit < 1 || limit > 500)) {
      res.status(400).json({ success: false, error: 'Invalid limit parameter (must be 1-500)' });
      return;
    }

    const analyses = getAnalyses({ status, outcome, limit });
    res.json({ success: true, data: analyses });
  } catch (error) {
    log.error('Failed to list analyses', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/kairos/analyses/:sessionId - Get single analysis
router.get('/analyses/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId?.trim()) {
      res.status(400).json({ success: false, error: 'Missing sessionId parameter' });
      return;
    }

    const analysis = getAnalysis(sessionId);
    if (!analysis) {
      res.status(404).json({ success: false, error: `Analysis not found for session: ${sessionId}` });
      return;
    }

    res.json({ success: true, data: analysis });
  } catch (error) {
    log.error('Failed to get analysis', { sessionId: req.params.sessionId, error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/kairos/correlations/:sessionId - Get correlations for a session
router.get('/correlations/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId?.trim()) {
      res.status(400).json({ success: false, error: 'Missing sessionId parameter' });
      return;
    }

    const correlations = getCorrelationsForSession(sessionId);
    res.json({ success: true, data: correlations });
  } catch (error) {
    log.error('Failed to get correlations', { sessionId: req.params.sessionId, error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/kairos/prompt-changes - Get prompt change history
router.get('/prompt-changes', (req: Request, res: Response) => {
  try {
    const file = req.query.file as string | undefined;
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    if (limitStr && (isNaN(limit) || limit < 1 || limit > 500)) {
      res.status(400).json({ success: false, error: 'Invalid limit parameter (must be 1-500)' });
      return;
    }

    const changes = getPromptChangeHistory(file, limit);
    res.json({ success: true, data: changes });
  } catch (error) {
    log.error('Failed to get prompt change history', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/kairos/prompt-changes/active - Get active (non-rolled-back) changes
router.get('/prompt-changes/active', (req: Request, res: Response) => {
  try {
    const changes = getActivePromptChanges();
    res.json({ success: true, data: changes });
  } catch (error) {
    log.error('Failed to get active prompt changes', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// POST /api/kairos/prompt-changes/:id/rollback - Rollback a prompt change
router.post('/prompt-changes/:id/rollback', async (req: Request, res: Response) => {
  try {
    const idStr = req.params.id;
    const id = parseInt(idStr, 10);

    if (isNaN(id) || id < 1) {
      res.status(400).json({ success: false, error: 'Invalid change ID' });
      return;
    }

    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ success: false, error: 'Missing or invalid "reason" in request body' });
      return;
    }

    const { rollbackPromptChange } = await import('../kairos-prompt-patcher.js');
    await rollbackPromptChange(id, reason.trim());

    log.info('Rolled back KAIROS prompt change', { id, reason: reason.trim() });
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to rollback prompt change', { id: req.params.id, error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// POST /api/kairos/analyze - Force KAIROS check on next tick
router.post('/analyze', async (_req: Request, res: Response) => {
  try {
    const { onKairosSessionComplete } = await import('../kairos-daemon.js');
    // Reset analyzing flag so the next tick will trigger KAIROS
    onKairosSessionComplete();
    res.json({ success: true, message: 'KAIROS will check for unanalyzed sessions on the next tick' });
  } catch (error) {
    log.error('Failed to reset KAIROS state', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
