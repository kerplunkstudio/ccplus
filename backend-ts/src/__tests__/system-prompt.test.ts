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

// Mock skills discovery to return empty by default
vi.mock('../sdk/skills.js', () => ({
  discoverSkills: vi.fn().mockReturnValue([]),
}));

// Mock mcp-config
vi.mock('../mcp-config.js', () => ({
  getAllMcpServers: vi.fn().mockReturnValue([]),
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
import { discoverSkills } from '../sdk/skills.js';
import { getAllMcpServers } from '../mcp-config.js';

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
      expect(prompt).toContain('You delegate ALL work to specialized agents');
      expect(prompt).toContain('You do NOT use Read, Edit, Write, Grep, Glob, or Bash yourself');
    });

    // Regression tests for workflow phase awareness fix in system-prompt.ts
    describe('regression: mandatory workflow phase completion instructions', () => {
      it('workflow phases section contains MANDATORY keyword', async () => {
        vi.mocked(loadAllAgents).mockResolvedValue([]);
        vi.mocked(formatAgentCatalog).mockReturnValue(null);

        const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

        expect(prompt).toContain('MANDATORY');
      });

      it('workflow phases section names merge-cleanup as a required phase', async () => {
        vi.mocked(loadAllAgents).mockResolvedValue([]);
        vi.mocked(formatAgentCatalog).mockReturnValue(null);

        const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

        expect(prompt).toContain('merge-cleanup');
      });

      it('workflow phases section instructs agent that remaining phases must be completed', async () => {
        vi.mocked(loadAllAgents).mockResolvedValue([]);
        vi.mocked(formatAgentCatalog).mockReturnValue(null);

        const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

        expect(prompt).toContain('remaining phases');
      });

      it('workflow phases section states task is not done while remaining phases exist', async () => {
        vi.mocked(loadAllAgents).mockResolvedValue([]);
        vi.mocked(formatAgentCatalog).mockReturnValue(null);

        const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

        // The fix ensures agents are told to not consider work done while phases remain
        expect(prompt).toMatch(/remaining phases exist|while remaining phases/i);
      });
    });

    it('contains "Tool blocked by workflow phase" failure handling guidance', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('Blocked tools');
    });

    it('contains "Do NOT retry the blocked tool" delegation instruction', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('Do NOT try to use blocked tools directly');
    });

    it('contains "agent_hints" in workflow phase transition text', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('agent_hints');
    });

    it('contains mandatory workflow completion requirement', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1');

      expect(prompt).toContain('MANDATORY: You MUST complete ALL workflow phases');
    });
  });

  describe('agent-specific skills and MCP tools', () => {
    it('agent with skills.required includes Required section', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(discoverSkills).mockReturnValue([
        { name: 'frontend-patterns', plugin: 'project', description: 'Frontend patterns guide' },
      ]);

      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        dirPath: '/test',
        skills: {
          required: ['frontend-patterns'],
        },
      };

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', agent as any);

      expect(prompt).toContain('## Agent Skills');
      expect(prompt).toContain('Required (MUST consult before making changes)');
      expect(prompt).toContain('/frontend-patterns');
    });

    it('agent with skills.available includes Available section', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(discoverSkills).mockReturnValue([
        { name: 'frontend-design', plugin: 'project', description: 'Design system' },
      ]);

      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        dirPath: '/test',
        skills: {
          available: ['frontend-design'],
        },
      };

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', agent as any);

      expect(prompt).toContain('## Agent Skills');
      expect(prompt).toContain('Available (use when relevant)');
      expect(prompt).toContain('/frontend-design');
    });

    it('agent with both required and available skills includes both sections', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(discoverSkills).mockReturnValue([
        { name: 'frontend-patterns', plugin: 'project', description: 'Frontend patterns guide' },
        { name: 'frontend-design', plugin: 'project', description: 'Design system' },
      ]);

      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        dirPath: '/test',
        skills: {
          required: ['frontend-patterns'],
          available: ['frontend-design'],
        },
      };

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', agent as any);

      expect(prompt).toContain('Required (MUST consult before making changes)');
      expect(prompt).toContain('Available (use when relevant)');
      expect(prompt).toContain('/frontend-patterns');
      expect(prompt).toContain('/frontend-design');
    });

    it('agent without skills config does not include MUST consult or use when relevant', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(discoverSkills).mockReturnValue([
        { name: 'some-skill', plugin: 'project', description: 'Some skill' },
      ]);

      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        dirPath: '/test',
      };

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', agent as any);

      expect(prompt).not.toContain('MUST consult before making changes');
      expect(prompt).not.toContain('use when relevant');
    });

    it('agent with mcpServers includes MCP Tools section', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(getAllMcpServers).mockReturnValue([
        { name: 'playwright', config: { type: 'stdio', command: 'playwright' }, scope: 'user', enabled: true },
      ]);

      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        dirPath: '/test',
        mcpServers: ['playwright'],
      };

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', agent as any);

      expect(prompt).toContain('## Available MCP Tools');
      expect(prompt).toContain('playwright');
      expect(prompt).toContain('Browser automation and testing');
    });

    it('agent with empty mcpServers does not include MCP section', async () => {
      vi.mocked(loadAllAgents).mockResolvedValue([]);
      vi.mocked(formatAgentCatalog).mockReturnValue(null);
      vi.mocked(getAllMcpServers).mockReturnValue([]);

      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        dirPath: '/test',
        mcpServers: [],
      };

      const prompt = await buildSystemPrompt('/test', 'user prompt', 'session-1', agent as any);

      expect(prompt).not.toContain('## Available MCP Tools');
    });
  });
});
