import { Router, type Request, type Response } from 'express';
import { loadWorkflow, listWorkflows, type WorkflowConfig } from '../workflow-config.js';
import { log } from '../logger.js';

const router = Router();

function transformWorkflowForFrontend(workflow: WorkflowConfig) {
  return {
    ...workflow,
    phases: workflow.phases.map(phase => ({
      name: phase.name,
      context: phase.context,
      agentHints: phase.agent_hints,
      toolRules: phase.tool_rules.map(rule => ({
        tool: rule.tool_name,
        action: rule.action,
        condition: rule.conditions.join(', '),
        message: rule.message ?? '',
      })),
    })),
  };
}

// GET /api/workflows - List all available workflows
router.get('/', (_req: Request, res: Response) => {
  try {
    const names = listWorkflows();
    const workflows = names.map(name => {
      try {
        return transformWorkflowForFrontend(loadWorkflow(name));
      } catch (err) {
        log.error('Failed to load workflow', { name, error: String(err) });
        return null;
      }
    }).filter(Boolean);
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
