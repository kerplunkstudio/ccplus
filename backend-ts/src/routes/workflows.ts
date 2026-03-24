import type { Express, Request, Response } from 'express';
import {
  listWorkflows,
  getWorkflowByName,
  saveWorkflow,
  deleteWorkflow,
  type WorkflowConfig,
} from '../workflow-config.js';

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
          return { ...wf, builtin: builtinNames.includes(name) };
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
      res.json(workflow);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/workflows — create or update a workflow
  app.post('/api/workflows', (req: Request, res: Response) => {
    try {
      const workflow = req.body as WorkflowConfig;
      if (!workflow?.name?.trim()) {
        res.status(400).json({ error: 'workflow.name is required' });
        return;
      }
      if (!Array.isArray(workflow.phases)) {
        res.status(400).json({ error: 'workflow.phases must be an array' });
        return;
      }
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

  // GET /api/agents — list available agent types
  app.get('/api/agents', (_req: Request, res: Response) => {
    // Return the well-known agent types available in cc+
    const agents = [
      { name: 'code_agent', description: 'General code implementation' },
      { name: 'frontend-agent', description: 'Frontend/UI changes' },
      { name: 'planner', description: 'Implementation planning' },
      { name: 'architect', description: 'System design decisions' },
      { name: 'tdd-guide', description: 'Test-driven development' },
      { name: 'code-reviewer', description: 'Code review' },
      { name: 'security-reviewer', description: 'Security analysis' },
      { name: 'build-error-resolver', description: 'Build/TypeScript error fixes' },
      { name: 'debugger', description: 'Systematic debugging' },
      { name: 'e2e-runner', description: 'E2E test generation' },
      { name: 'refactor-cleaner', description: 'Dead code cleanup' },
      { name: 'doc-updater', description: 'Documentation updates' },
    ];
    res.json({ agents });
  });
}
