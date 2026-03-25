import { Router, type Request, type Response } from 'express';
import { getWorkflowByName, type WorkflowConfig } from '../workflow-config.js';
import { getAllWorkflows, upsertWorkflow, deleteWorkflow } from '../db/workflows.js';
import { log } from '../logger.js';

const router = Router();

function transformWorkflowForFrontend(workflow: WorkflowConfig) {
  return {
    ...workflow,
    builtin: workflow.builtin ?? false,
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

function transformWorkflowFromFrontend(data: Record<string, unknown>): WorkflowConfig {
  const phases = (data.phases as Array<{
    name: string;
    context: string;
    agentHints: string[];
    toolRules: Array<{ tool: string; action: string; condition: string; message: string }>;
  }>).map(phase => ({
    name: phase.name,
    context: phase.context,
    agent_hints: phase.agentHints,
    tool_rules: phase.toolRules.map(rule => ({
      tool_name: rule.tool,
      action: rule.action as 'allow' | 'warn' | 'block',
      conditions: rule.condition.split(',').map(c => c.trim()).filter(Boolean),
      message: rule.message || undefined,
    })),
  }));

  return {
    name: data.name as string,
    description: data.description as string,
    default_phase: data.default_phase as string,
    phases,
    transitions: data.transitions as Array<{ from: string; to: string }>,
    worktree: data.worktree as boolean | undefined,
  };
}

// GET /api/workflows - List all available workflows
router.get('/', (_req: Request, res: Response) => {
  try {
    const workflows = getAllWorkflows();
    const transformed = workflows.map(transformWorkflowForFrontend);
    res.json({ success: true, data: transformed });
  } catch (error) {
    log.error('Failed to list workflows', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/workflows/:name - Get workflow configuration by name
router.get('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const workflow = getWorkflowByName(name);
    if (!workflow) {
      res.status(404).json({ success: false, error: `Workflow not found: ${name}` });
      return;
    }
    res.json({ success: true, data: transformWorkflowForFrontend(workflow) });
  } catch (error) {
    log.error('Failed to load workflow', { name: req.params.name, error: String(error) });
    res.status(404).json({ success: false, error: String(error) });
  }
});

// POST /api/workflows - Create or update workflow
router.post('/', (req: Request, res: Response) => {
  try {
    const workflow = transformWorkflowFromFrontend(req.body);
    upsertWorkflow(workflow, false);
    log.info('Saved workflow to database', { name: workflow.name });
    res.json({ success: true, data: transformWorkflowForFrontend(workflow) });
  } catch (error) {
    log.error('Failed to save workflow', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// DELETE /api/workflows/:name - Delete workflow
router.delete('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const deleted = deleteWorkflow(name);
    if (!deleted) {
      res.status(404).json({ success: false, error: `Workflow not found: ${name}` });
      return;
    }
    log.info('Deleted workflow from database', { name });
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to delete workflow', { name: req.params.name, error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
