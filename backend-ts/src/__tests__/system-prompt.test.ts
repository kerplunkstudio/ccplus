import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all dependencies before imports
vi.mock('../agent-config.js');
vi.mock('../workflow-config.js');
vi.mock('../workflow-state.js');
vi.mock('../memory-client.js', () => ({
  searchMemories: vi.fn().mockResolvedValue(null),
}));
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    getMemoryEnabled: vi.fn().mockReturnValue(false),
  };
});
vi.mock('../database.js');
vi.mock('../logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock skills discovery to return empty
vi.mock('../sdk/skills.js', () => ({
  discoverSkills: vi.fn().mockReturnValue([]),
}));

// Mock agent-catalog functions
vi.mock('../agent-catalog.js', () => ({
  formatAgentCatalog: vi.fn().mockReturnValue(null),
  formatWorkflowContext: vi.fn().mockReturnValue(null),
}));

import { buildSystemPrompt } from '../sdk/system-prompt.js';
import { loadAllAgents } from '../agent-config.js';
import { loadWorkflow } from '../workflow-config.js';
import { getWorkflowState } from '../workflow-state.js';
import { formatAgentCatalog, formatWorkflowContext } from '../agent-catalog.js';

describe('system-prompt', () => {
  const mockAgents = [
    { id: 'planner', name: 'Planner', description: 'Plans features', model: 'sonnet', dirPath: '/test' },
    { id: 'code_agent', name: 'Code Agent', description: 'Writes code', model: 'sonnet', dirPath: '/test' },
  ];

  const mockWorkflow = {
    name: 'feature',
    description: 'Feature workflow',
    default_phase: 'design',
    phases: [
      { name: 'design', context: 'Design phase', agent_hints: [], tool_rules: [] },
      { name: 'execute', context: 'Execute phase', agent_hints: [], tool_rules: [] },
    ],
    transitions: [{ from: 'design', to: 'execute' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSystemPrompt', () => {
    it('without workflow does not include workflow section', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('# Session Instructions');
      expect(prompt).not.toContain('## Active Workflow:');
      expect(prompt).not.toContain('Current Phase:');
    });

    it('with workflow includes workflow context', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(loadWorkflow).mockReturnValue(mockWorkflow);
      vi.mocked(getWorkflowState).mockReturnValue({
        phase: 'execute',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'session-1',
        createdAt: '2024-01-01',
      });
      vi.mocked(formatWorkflowContext).mockReturnValue('## Active Workflow: feature\nCurrent phase: execute');

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', undefined, 'feature');

      expect(prompt).toContain('## Active Workflow: feature');
      expect(prompt).toContain('execute');
    });

    it('includes agent catalog when agents exist', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue(mockAgents as any);
      vi.mocked(formatAgentCatalog).mockReturnValue('## Available Agents\n- planner\n- code_agent');

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('Available Agents');
      expect(prompt).toContain('planner');
      expect(prompt).toContain('code_agent');
    });

    it('graceful when loadAllAgents returns empty', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('# Session Instructions');
      expect(prompt).not.toContain('Available Agents');
    });

    it('graceful when loadAllAgents throws', async () => {
      vi.mocked(loadAllAgents).mockRejectedValue(new Error('Failed to load agents'));
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('# Session Instructions');
      expect(prompt).not.toContain('Available Agents');
    });

    it('graceful when loadWorkflow throws', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(loadWorkflow).mockImplementation(() => {
        throw new Error('Workflow not found');
      });

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', undefined, 'invalid');

      expect(prompt).toContain('# Session Instructions');
      expect(prompt).not.toContain('## Active Workflow:');
    });

    it('no longer contains hardcoded Mandatory Workflow', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).not.toContain('Mandatory Workflow');
    });

    it('contains orchestrator role description', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('You are an orchestrator');
      expect(prompt).toContain('delegate work to specialized agents');
    });
  });
});
