import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import yaml from 'js-yaml';
import { loadWorkflow, listWorkflows, type WorkflowConfig } from '../workflow-config.js';
import { log } from '../logger.js';
import { PROJECT_ROOT } from '../config.js';

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

function isValidWorkflowName(name: string): boolean {
  return !name.includes('..') && !name.includes('/') && name.length > 0;
}

function transformWorkflowFromFrontend(data: Record<string, unknown>): WorkflowConfig {
  const phases = Array.isArray(data.phases) ? data.phases : [];
  return {
    name: data.name as string,
    description: (data.description ?? '') as string,
    default_phase: (data.default_phase ?? '') as string,
    transitions: Array.isArray(data.transitions) ? data.transitions as WorkflowConfig['transitions'] : [],
    ...(data.worktree !== undefined && { worktree: Boolean(data.worktree) }),
    phases: phases.map((phase: Record<string, unknown>) => ({
      name: phase.name as string,
      context: (phase.context ?? '') as string,
      agent_hints: Array.isArray(phase.agentHints) ? phase.agentHints as string[] : [],
      tool_rules: Array.isArray(phase.toolRules)
        ? phase.toolRules.map((rule: Record<string, unknown>) => ({
            tool_name: rule.tool as string,
            action: rule.action as 'allow' | 'warn' | 'block',
            conditions: typeof rule.condition === 'string' && rule.condition
              ? rule.condition.split(',').map((c: string) => c.trim()).filter(Boolean)
              : [],
            message: (rule.message ?? '') as string,
          }))
        : [],
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

// POST /api/workflows - Save/create a workflow
router.post('/', (req: Request, res: Response) => {
  try {
    const data = req.body as Record<string, unknown>;
    const name = data.name as string;

    if (!name || !isValidWorkflowName(name)) {
      res.status(400).json({ success: false, error: 'Invalid workflow name' });
      return;
    }

    const workflow = transformWorkflowFromFrontend(data);
    const workflowDir = path.join(PROJECT_ROOT, '.ccplus', 'workflows', name);
    const workflowPath = path.join(workflowDir, 'workflow.yaml');

    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(workflowPath, yaml.dump(workflow), 'utf8');

    log.info('Workflow saved', { name });
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to save workflow', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

// DELETE /api/workflows/:name - Delete a workflow
router.delete('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    if (!isValidWorkflowName(name)) {
      res.status(400).json({ success: false, error: 'Invalid workflow name' });
      return;
    }

    if (name === 'default') {
      res.status(403).json({ success: false, error: 'Cannot delete the default workflow' });
      return;
    }

    const workflowDir = path.join(PROJECT_ROOT, '.ccplus', 'workflows', name);

    if (!fs.existsSync(workflowDir)) {
      res.status(404).json({ success: false, error: `Workflow '${name}' not found` });
      return;
    }

    fs.rmSync(workflowDir, { recursive: true, force: true });

    log.info('Workflow deleted', { name });
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to delete workflow', { error: String(error) });
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
