import type { Express, Request, Response } from 'express';
import {
  listWorkflows,
  getWorkflowByName,
  saveWorkflow,
  deleteWorkflow,
  type WorkflowConfig,
} from '../workflow-config.js';

/**
 * Transform workflow phases from internal snake_case format to frontend camelCase format
 */
function transformWorkflowForFrontend(wf: WorkflowConfig): WorkflowConfig {
  return {
    ...wf,
    worktree: wf.worktree,
    phases: wf.phases.map(phase => ({
      name: phase.name,
      context: phase.context,
      agentHints: phase.agent_hints,
      toolRules: (phase.tool_rules || []).map(rule => ({
        tool: rule.tool_name || rule.tool || '',
        action: rule.action,
        condition: rule.condition,
        message: rule.message,
      })),
    })),
  };
}

function transformWorkflowFromFrontend(wf: Record<string, unknown>): WorkflowConfig {
  const phases = (wf.phases as Array<Record<string, unknown>>) || [];
  return {
    name: wf.name as string,
    description: wf.description as string | undefined,
    worktree: wf.worktree as boolean | undefined,
    transitions: wf.transitions as WorkflowConfig['transitions'],
    phases: phases.map(phase => ({
      name: phase.name as string,
      context: phase.context as string | undefined,
      agent_hints: (phase.agentHints || phase.agent_hints) as string[] | undefined,
      tool_rules: ((phase.toolRules || phase.tool_rules) as Array<Record<string, unknown>> || []).map(rule => ({
        tool_name: (rule.tool || rule.tool_name) as string | undefined,
        action: rule.action as 'allow' | 'warn' | 'block',
        condition: rule.condition as string | undefined,
        message: rule.message as string | undefined,
      })),
    })),
  };
}

export function createWorkflowConfigRoutes(app: Express): void {
  // GET /api/workflows — list all workflows (built-in + user)
  app.get('/api/workflows', (req: Request, res: Response) => {
    try {
      const workspace = (req.query.workspace as string) || process.cwd();
      const workflowNames = listWorkflows(workspace);
      const builtinNames = ['default', 'feature', 'debug', 'tdd', 'hotfix'];
      const workflows = workflowNames
        .map(name => {
          const wf = getWorkflowByName(name, workspace);
          if (!wf) return null;
          const transformed = transformWorkflowForFrontend(wf);
          return { ...transformed, builtin: builtinNames.includes(name) };
        })
        .filter((wf): wf is WorkflowConfig & { builtin: boolean } => wf !== null);
      res.json({ workflows });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/workflows/:name — get single workflow
  app.get('/api/workflows/:name', (req: Request, res: Response) => {
    try {
      const workspace = (req.query.workspace as string) || process.cwd();
      const workflow = getWorkflowByName(req.params.name, workspace);
      if (!workflow) {
        res.status(404).json({ error: `Workflow "${req.params.name}" not found` });
        return;
      }
      const transformed = transformWorkflowForFrontend(workflow);
      res.json(transformed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/workflows — create or update a workflow
  app.post('/api/workflows', (req: Request, res: Response) => {
    try {
      const raw = req.body as Record<string, unknown>;
      if (!raw?.name || !(raw.name as string).trim()) {
        res.status(400).json({ error: 'workflow.name is required' });
        return;
      }
      if (!Array.isArray(raw.phases)) {
        res.status(400).json({ error: 'workflow.phases must be an array' });
        return;
      }
      const workflow = transformWorkflowFromFrontend(raw);
      const savedName = saveWorkflow(workflow);
      res.status(201).json({ success: true, name: savedName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/workflows/:name — delete a user workflow (built-ins cannot be deleted)
  app.delete('/api/workflows/:name', (req: Request, res: Response) => {
    try {
      const deleted = deleteWorkflow(req.params.name);
      if (!deleted) {
        res.status(404).json({ error: `Workflow "${req.params.name}" not found or is a built-in` });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });
}
