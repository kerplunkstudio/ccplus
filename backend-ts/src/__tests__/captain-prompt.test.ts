import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isIdleMessage,
  buildCaptainSystemPrompt,
  CAPTAIN_SYSTEM_PROMPT_TEMPLATE,
} from '../captain-prompt.js';
import * as agentConfig from '../agent-config.js';
import * as workflowConfig from '../workflow-config.js';
import * as agentCatalog from '../agent-catalog.js';
import type { ResolvedAgent } from '../agent-config.js';
import type { WorkflowConfig, WorkflowPhaseConfig } from '../workflow-config.js';

describe('captain-prompt', () => {
  describe('isIdleMessage', () => {
    it('returns false for long messages (> 120 chars)', () => {
      const longMessage = 'A'.repeat(121);
      expect(isIdleMessage(longMessage)).toBe(false);
    });

    it('returns false for short messages that do not match idle patterns', () => {
      expect(isIdleMessage('Starting session abc-123')).toBe(false);
      expect(isIdleMessage('Session completed successfully')).toBe(false);
      expect(isIdleMessage('Running tests')).toBe(false);
      expect(isIdleMessage('Error: something went wrong')).toBe(false);
    });

    it('returns true for "no pending work" pattern', () => {
      expect(isIdleMessage('No pending work.')).toBe(true);
      expect(isIdleMessage('There is no pending work')).toBe(true);
    });

    it('returns true for "what\'s next" pattern', () => {
      expect(isIdleMessage('What\'s next?')).toBe(true);
      expect(isIdleMessage('Whats next')).toBe(true);
    });

    it('returns true for "no response requested" pattern', () => {
      expect(isIdleMessage('No response requested')).toBe(true);
    });

    it('returns true for "nothing to do" pattern', () => {
      expect(isIdleMessage('Nothing to do.')).toBe(true);
      expect(isIdleMessage('There is nothing to do')).toBe(true);
    });

    it('returns true for "awaiting instructions" pattern', () => {
      expect(isIdleMessage('Awaiting instructions')).toBe(true);
      expect(isIdleMessage('Awaiting your instructions')).toBe(true);
      expect(isIdleMessage('Awaiting further instructions')).toBe(true);
      expect(isIdleMessage('Awaiting input')).toBe(true);
      expect(isIdleMessage('Awaiting your requests')).toBe(true);
    });

    it('returns true for "standing by" pattern', () => {
      expect(isIdleMessage('Standing by')).toBe(true);
      expect(isIdleMessage('Standing by for instructions')).toBe(true);
    });

    it('returns true for "ready for next" pattern', () => {
      expect(isIdleMessage('Ready for the next task')).toBe(true);
      expect(isIdleMessage('Ready for your next command')).toBe(true);
      expect(isIdleMessage('Ready for next')).toBe(true);
    });

    it('returns true for "no tasks" pattern', () => {
      expect(isIdleMessage('No tasks available')).toBe(true);
      expect(isIdleMessage('No new tasks')).toBe(true);
    });

    it('returns true for "waiting for instructions" pattern', () => {
      expect(isIdleMessage('Waiting for instructions')).toBe(true);
      expect(isIdleMessage('Waiting for your instructions')).toBe(true);
      expect(isIdleMessage('Waiting for further input')).toBe(true);
      expect(isIdleMessage('Waiting for direction')).toBe(true);
    });

    it('is case insensitive', () => {
      expect(isIdleMessage('NO PENDING WORK')).toBe(true);
      expect(isIdleMessage('STANDING BY')).toBe(true);
      expect(isIdleMessage('Nothing To Do')).toBe(true);
    });

    it('returns false for messages at exactly 120 chars with non-idle content', () => {
      const exactMessage = 'A'.repeat(120);
      expect(isIdleMessage(exactMessage)).toBe(false);
    });

    it('returns true for messages at exactly 120 chars with idle pattern', () => {
      const idleMessage = 'Standing by'.padEnd(120, ' ');
      expect(isIdleMessage(idleMessage)).toBe(true);
    });
  });

  describe('CAPTAIN_SYSTEM_PROMPT_TEMPLATE', () => {
    it('contains key sections', () => {
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('You are Captain');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## The Golden Rule');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Your Workflow');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Starting Sessions');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Workflow Selection (MANDATORY)');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Parallelization (CRITICAL)');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Monitoring & Intervention');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Memory');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## MCP Tool Failures');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Agent Awareness');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Response Style');
    });

    it('explicitly forbids Edit, Write, and Agent tools', () => {
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('Edit/Write files or use NotebookEdit');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('Spawn Agent subagents');
    });

    it('mentions workflow types', () => {
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('feature');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('bug-fix');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('tdd');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('security-audit');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('default');
    });

    it('includes agent awareness section', () => {
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('## Agent Awareness');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('frontend-agent');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('tdd-guide');
      expect(CAPTAIN_SYSTEM_PROMPT_TEMPLATE).toContain('code-reviewer');
    });
  });

  describe('buildCaptainSystemPrompt', () => {
    const testWorkspace = '/test/workspace';

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns base template when no workflows available', async () => {
      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue([]);
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue([]);

      const result = await buildCaptainSystemPrompt(testWorkspace);

      expect(result).toContain('You are Captain');
      expect(result).not.toContain('## Available Workflows');
      expect(workflowConfig.listWorkflows).toHaveBeenCalledWith(testWorkspace);
    });

    it('includes workflow section when workflows are available', async () => {
      const mockWorkflow: WorkflowConfig = {
        name: 'feature',
        description: 'Feature development workflow',
        default_phase: 'design',
        phases: [
          { name: 'design', context: '', agent_hints: [], tool_rules: [] },
          { name: 'plan', context: '', agent_hints: [], tool_rules: [] },
          { name: 'execute', context: '', agent_hints: [], tool_rules: [] },
        ],
        transitions: [],
      };

      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue(['feature']);
      vi.spyOn(workflowConfig, 'getWorkflowByName').mockReturnValue(mockWorkflow);
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue([]);

      const result = await buildCaptainSystemPrompt(testWorkspace);

      expect(result).toContain('## Available Workflows');
      expect(result).toContain('- **feature** (Feature development workflow): design → plan → execute');
      expect(workflowConfig.listWorkflows).toHaveBeenCalledWith(testWorkspace);
      expect(workflowConfig.getWorkflowByName).toHaveBeenCalledWith('feature', testWorkspace);
    });

    it('includes agent catalog section when agents are available', async () => {
      const mockAgents: ResolvedAgent[] = [
        {
          id: 'code-agent',
          name: 'code-agent',
          description: 'Backend code implementation',
          model: 'sonnet',
          dirPath: '/agents/code-agent',
        } as any,
      ];

      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue([]);
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue(mockAgents);
      vi.spyOn(agentCatalog, 'formatAgentCatalogForCaptain').mockReturnValue('## Agents Available to Sessions\nMock agent catalog');

      const result = await buildCaptainSystemPrompt(testWorkspace);

      expect(result).toContain('## Agents Available to Sessions');
      expect(result).toContain('Mock agent catalog');
      expect(agentConfig.loadAllAgents).toHaveBeenCalledWith(testWorkspace);
      expect(agentCatalog.formatAgentCatalogForCaptain).toHaveBeenCalledWith(mockAgents);
    });

    it('includes phase enforcement section for feature workflow', async () => {
      const mockPhases: WorkflowPhaseConfig[] = [
        {
          name: 'design',
          context: 'Design the solution',
          agent_hints: ['architect'],
          tool_rules: [
            { tool_name: 'Edit', action: 'block', conditions: [] },
          ],
        },
      ];

      const mockWorkflow: WorkflowConfig = {
        name: 'feature',
        description: 'Feature workflow',
        default_phase: 'design',
        phases: mockPhases,
        transitions: [],
      };

      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue([]);
      vi.spyOn(workflowConfig, 'getWorkflowByName').mockReturnValue(mockWorkflow);
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue([]);
      vi.spyOn(agentCatalog, 'formatPhaseEnforcement').mockReturnValue('## Phase Enforcement\nMock enforcement');

      const result = await buildCaptainSystemPrompt(testWorkspace);

      expect(result).toContain('## Phase Enforcement');
      expect(result).toContain('Mock enforcement');
      expect(result).toContain('Note: Phase enforcement applies to sessions, not to Captain');
      expect(workflowConfig.getWorkflowByName).toHaveBeenCalledWith('feature', testWorkspace);
      expect(agentCatalog.formatPhaseEnforcement).toHaveBeenCalledWith(mockWorkflow);
    });

    it('does not include phase enforcement when feature workflow not found', async () => {
      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue([]);
      vi.spyOn(workflowConfig, 'getWorkflowByName').mockReturnValue(null);
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue([]);

      const result = await buildCaptainSystemPrompt(testWorkspace);

      expect(result).not.toContain('## Phase Enforcement');
      expect(workflowConfig.getWorkflowByName).toHaveBeenCalledWith('feature', testWorkspace);
    });

    it('handles agent loading errors gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue([]);
      vi.spyOn(agentConfig, 'loadAllAgents').mockRejectedValue(new Error('Agent config not found'));

      const result = await buildCaptainSystemPrompt(testWorkspace);

      // Should still return a valid prompt
      expect(result).toContain('You are Captain');
      expect(result).not.toContain('## Agents Available to Sessions');

      consoleWarnSpy.mockRestore();
    });

    it('handles phase enforcement loading errors gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue([]);
      vi.spyOn(workflowConfig, 'getWorkflowByName').mockImplementation(() => {
        throw new Error('Workflow not found');
      });
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue([]);

      const result = await buildCaptainSystemPrompt(testWorkspace);

      // Should still return a valid prompt
      expect(result).toContain('You are Captain');
      expect(result).not.toContain('## Phase Enforcement');

      consoleWarnSpy.mockRestore();
    });

    it('combines all sections correctly when all are available', async () => {
      const mockWorkflow: WorkflowConfig = {
        name: 'feature',
        description: 'Feature workflow',
        default_phase: 'design',
        phases: [
          { name: 'design', context: '', agent_hints: [], tool_rules: [] },
          { name: 'execute', context: '', agent_hints: [], tool_rules: [] },
        ],
        transitions: [],
      };

      const mockAgents: ResolvedAgent[] = [
        {
          id: 'code-agent',
          name: 'code-agent',
          description: 'Code implementation',
          model: 'sonnet',
          dirPath: '/agents/code-agent',
        } as any,
      ];

      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue(['feature', 'bug-fix']);
      vi.spyOn(workflowConfig, 'getWorkflowByName').mockReturnValue(mockWorkflow);
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue(mockAgents);
      vi.spyOn(agentCatalog, 'formatAgentCatalogForCaptain').mockReturnValue('## Agents Available to Sessions\nAgent catalog');
      vi.spyOn(agentCatalog, 'formatPhaseEnforcement').mockReturnValue('## Phase Enforcement\nEnforcement rules');

      const result = await buildCaptainSystemPrompt(testWorkspace);

      // Base template
      expect(result).toContain('You are Captain');

      // Workflow section
      expect(result).toContain('## Available Workflows');
      expect(result).toContain('- **feature** (Feature workflow): design → execute');

      // Agent catalog section
      expect(result).toContain('## Agents Available to Sessions');
      expect(result).toContain('Agent catalog');

      // Phase enforcement section
      expect(result).toContain('## Phase Enforcement');
      expect(result).toContain('Enforcement rules');
      expect(result).toContain('Note: Phase enforcement applies to sessions');
    });

    it('skips workflows with no phases', async () => {
      const mockWorkflowWithPhases: WorkflowConfig = {
        name: 'feature',
        description: 'Feature workflow',
        default_phase: 'design',
        phases: [
          { name: 'design', context: '', agent_hints: [], tool_rules: [] },
        ],
        transitions: [],
      };

      const mockWorkflowNoPhases: WorkflowConfig = {
        name: 'minimal',
        description: 'Minimal workflow',
        default_phase: 'execute',
        phases: [],
        transitions: [],
      };

      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue(['feature', 'minimal']);
      vi.spyOn(workflowConfig, 'getWorkflowByName').mockImplementation((name, _workspace) => {
        return name === 'feature' ? mockWorkflowWithPhases : mockWorkflowNoPhases;
      });
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue([]);

      const result = await buildCaptainSystemPrompt(testWorkspace);

      expect(result).toContain('- **feature** (Feature workflow): design');
      expect(result).toContain('- **minimal** (Minimal workflow): no phases');
    });

    it('filters out null workflows', async () => {
      vi.spyOn(workflowConfig, 'listWorkflows').mockReturnValue(['feature', 'nonexistent']);
      vi.spyOn(workflowConfig, 'getWorkflowByName').mockImplementation((name, _workspace) => {
        if (name === 'feature') {
          return {
            name: 'feature',
            description: 'Feature workflow',
            default_phase: 'design',
            phases: [{ name: 'design', context: '', agent_hints: [], tool_rules: [] }],
            transitions: [],
          };
        }
        return null;
      });
      vi.spyOn(agentConfig, 'loadAllAgents').mockResolvedValue([]);

      const result = await buildCaptainSystemPrompt(testWorkspace);

      expect(result).toContain('- **feature**');
      expect(result).not.toContain('- **nonexistent**');
    });
  });
});
