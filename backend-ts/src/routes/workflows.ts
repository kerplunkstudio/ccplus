import { Router, type Request, type Response } from 'express';
import { loadWorkflow, listWorkflows } from '../workflow-config.js';
import { log } from '../logger.js';

const router = Router();

// GET /api/workflows - List all available workflows
router.get('/', (_req: Request, res: Response) => {
  try {
    const workflows = listWorkflows();
    res.json({ success: true, data: workflows });
  } catch (error) {
    log.error('Failed to list workflows', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/workflows/:name - Get workflow configuration by name
router.get('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const workflow = loadWorkflow(name);
    res.json({ success: true, data: workflow });
  } catch (error) {
    log.error('Failed to load workflow', { name: req.params.name, error: String(error) });
    res.status(404).json({ success: false, error: String(error) });
  }
});

export default router;
