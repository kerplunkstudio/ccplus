import type { Express, Request, Response } from 'express';
import {
  loadAllAgents,
  getAgent,
  writeAgent,
  deleteAgent,
  AgentConfigSchema,
  SAFE_AGENT_ID_RE,
} from '../agent-config.js';
import { log } from '../logger.js';

function normalizeAgent(agent: Awaited<ReturnType<typeof getAgent>>) {
  if (!agent) return agent;
  return {
    ...agent,
    personality: agent.soulContent || agent.personality || '',
  };
}

export function createAgentRoutes(
  app: Express,
  deps: { getWorkspaceForSession: (sessionId?: string) => string },
): void {
  const { getWorkspaceForSession } = deps;

  // GET /api/agents — list all agents for workspace
  app.get('/api/agents', async (req: Request, res: Response) => {
    try {
      const workspace = getWorkspaceForSession(req.query.session_id as string | undefined);
      const agents = await loadAllAgents(workspace);
      res.json({ agents: agents.map(normalizeAgent) });
    } catch (err) {
      log.error('Failed to load agents', { error: String(err) });
      res.status(500).json({ error: 'Failed to load agents' });
    }
  });

  // GET /api/agents/:id — get single agent
  app.get('/api/agents/:id', async (req: Request, res: Response) => {
    try {
      if (!SAFE_AGENT_ID_RE.test(req.params.id)) {
        res.status(400).json({ error: 'id must be alphanumeric with dashes/underscores (max 64 chars)' });
        return;
      }
      const workspace = getWorkspaceForSession(req.query.session_id as string | undefined);
      const agent = await getAgent(workspace, req.params.id);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      res.json({ agent: normalizeAgent(agent) });
    } catch (err) {
      log.error('Failed to get agent', { agentId: req.params.id, error: String(err) });
      res.status(500).json({ error: 'Failed to get agent' });
    }
  });

  // POST /api/agents — create or update agent
  app.post('/api/agents', async (req: Request, res: Response) => {
    try {
      const { id, config: agentConfig, soulContent, scope, session_id: sessionId } = req.body ?? {};

      if (!id || typeof id !== 'string' || !SAFE_AGENT_ID_RE.test(id)) {
        res.status(400).json({ error: 'id must be alphanumeric with dashes/underscores (max 64 chars)' });
        return;
      }

      const configResult = AgentConfigSchema.safeParse(agentConfig);
      if (!configResult.success) {
        res.status(400).json({ error: 'Invalid agent config', details: configResult.error.issues });
        return;
      }

      const workspace = getWorkspaceForSession(sessionId);
      const agent = await writeAgent(
        workspace,
        id,
        configResult.data,
        typeof soulContent === 'string' ? soulContent : undefined,
        scope === 'global' ? 'global' : 'project',
      );

      res.json({ agent: normalizeAgent(agent) });
    } catch (err) {
      log.error('Failed to write agent', { error: String(err) });
      res.status(500).json({ error: 'Failed to write agent' });
    }
  });

  // DELETE /api/agents/:id — delete agent directory
  app.delete('/api/agents/:id', async (req: Request, res: Response) => {
    try {
      if (!SAFE_AGENT_ID_RE.test(req.params.id)) {
        res.status(400).json({ error: 'id must be alphanumeric with dashes/underscores (max 64 chars)' });
        return;
      }
      const workspace = getWorkspaceForSession(req.query.session_id as string | undefined);
      const deleted = await deleteAgent(workspace, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      log.error('Failed to delete agent', { agentId: req.params.id, error: String(err) });
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  });
}
