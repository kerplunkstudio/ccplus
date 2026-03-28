import { describe, it, expect } from 'vitest';
import {
  formatAgentCatalog,
  formatPhaseEnforcement,
  formatWorkflowContext,
} from '../agent-catalog.js';
import type { ResolvedAgent } from '../agent-config.js';
import type { WorkflowConfig, WorkflowPhaseConfig, WorkflowTransition, ToolRule } from '../workflow-config.js';

describe('agent-catalog', () => {
  describe('formatAgentCatalog', () => {
    it('returns empty string for empty array', () => {
      const result = formatAgentCatalog([]);
      expect(result).toBe('');
    });

    it('formats multiple agents as markdown table with correct columns', () => {
      const agents: ResolvedAgent[] = [
        {
          id: 'code-agent',
          name: 'code-agent',
          description: 'Backend code implementation',
          model: 'sonnet',
          dirPath: '/home/user/.claude/agents/code-agent',
        } as any,
        {
          id: 'frontend-agent',
          name: 'frontend-agent',
          description: 'React components and styling',
          model: 'haiku',
          dirPath: '/home/user/.claude/agents/frontend-agent',
        } as any,
      ];

      const result = formatAgentCatalog(agents);

      expect(result).toContain('## Available Agents');
      expect(result).toContain('Use the Agent tool to delegate to these specialists.');
      expect(result).toContain('| Agent | Description | Model | Tool Restrictions |');
      expect(result).toContain('|-------|-------------|-------|-------------------|');
      expect(result).toContain('| code-agent | Backend code implementation | sonnet | All tools |');
      expect(result).toContain('| frontend-agent | React components and styling | haiku | All tools |');
    });

    it('shows "All except: Edit, Write" for agent with blocked tools', () => {
      const agents: ResolvedAgent[] = [
        {
          id: 'planner',
          name: 'planner',
          description: 'Implementation planning',
          model: 'sonnet',
          tools: {
            blocked: ['Edit', 'Write'],
          },
          dirPath: '/home/user/.claude/agents/planner',
        } as any,
      ];

      const result = formatAgentCatalog(agents);

      expect(result).toContain('| planner | Implementation planning | sonnet | All except: Edit, Write |');
    });

    it('shows "Read, Grep only" for agent with allowed tools', () => {
      const agents: ResolvedAgent[] = [
        {
          id: 'code-reviewer',
          name: 'code-reviewer',
          description: 'Code review and analysis',
          model: 'opus',
          tools: {
            allowed: ['Read', 'Grep'],
          },
          dirPath: '/home/user/.claude/agents/code-reviewer',
        } as any,
      ];

      const result = formatAgentCatalog(agents);

      expect(result).toContain('| code-reviewer | Code review and analysis | opus | Read, Grep only |');
    });

    it('shows "All tools" for agent with no tools field', () => {
      const agents: ResolvedAgent[] = [
        {
          id: 'architect',
          name: 'architect',
          description: 'System design decisions',
          model: 'opus',
          dirPath: '/home/user/.claude/agents/architect',
        } as any,
      ];

      const result = formatAgentCatalog(agents);

      expect(result).toContain('| architect | System design decisions | opus | All tools |');
    });

    it('handles missing description and model fields', () => {
      const agents: ResolvedAgent[] = [
        {
          id: 'minimal-agent',
          name: 'minimal-agent',
          dirPath: '/home/user/.claude/agents/minimal-agent',
        } as any,
      ];

      const result = formatAgentCatalog(agents);

      expect(result).toContain('| minimal-agent |  | default | All tools |');
    });
  });

  describe('formatPhaseEnforcement', () => {
    it('returns empty string for null workflow', () => {
      const result = formatPhaseEnforcement(null);
      expect(result).toBe('');
    });

    it('returns empty string for workflow with no phases', () => {
      const workflow: WorkflowConfig = {
        name: 'test',
        description: 'Test workflow',
        default_phase: 'execute',
        phases: [],
        transitions: [],
      };

      const result = formatPhaseEnforcement(workflow);
      expect(result).toBe('');
    });

    it('formats workflow with blocked and warned tools correctly', () => {
      const toolRules: ToolRule[] = [
        {
          tool_name: 'Edit',
          action: 'block',
          conditions: ['phase === "review"'],
          message: 'No editing in review phase',
        },
        {
          tool_name: 'Write',
          action: 'block',
          conditions: ['phase === "review"'],
        },
        {
          tool_name: 'Bash',
          action: 'warn',
          conditions: ['tool.command.includes("rm")'],
          message: 'Be careful with destructive commands',
        },
      ];

      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'review',
          context: 'Review code without making changes',
          agent_hints: ['code-reviewer'],
          tool_rules: toolRules,
        },
      ];

      const workflow: WorkflowConfig = {
        name: 'test',
        description: 'Test workflow',
        default_phase: 'review',
        phases: phases,
        transitions: [],
      };

      const result = formatPhaseEnforcement(workflow);

      expect(result).toContain('## Phase Enforcement');
      expect(result).toContain('Each workflow phase restricts which tools can be used:');
      expect(result).toContain('### review');
      expect(result).toContain('- **Blocked**: Edit, Write');
      expect(result).toContain('- **Warned**: Bash');
    });

    it('shows "All tools allowed" for phase with empty tool_rules', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'execute',
          context: 'Implement the feature',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
      ];

      const workflow: WorkflowConfig = {
        name: 'test',
        description: 'Test workflow',
        default_phase: 'execute',
        phases: phases,
        transitions: [],
      };

      const result = formatPhaseEnforcement(workflow);

      expect(result).toContain('### execute');
      expect(result).toContain('- All tools allowed');
    });

    it('shows "All tools allowed" for phase with only allow rules', () => {
      const toolRules: ToolRule[] = [
        {
          tool_name: 'Read',
          action: 'allow',
          conditions: [],
        },
        {
          tool_name: 'Grep',
          action: 'allow',
          conditions: [],
        },
      ];

      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'research',
          context: 'Research the codebase',
          agent_hints: ['architect'],
          tool_rules: toolRules,
        },
      ];

      const workflow: WorkflowConfig = {
        name: 'test',
        description: 'Test workflow',
        default_phase: 'research',
        phases: phases,
        transitions: [],
      };

      const result = formatPhaseEnforcement(workflow);

      expect(result).toContain('### research');
      expect(result).toContain('- All tools allowed');
    });

    it('formats multiple phases with different rules', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'design',
          context: 'Design the solution',
          agent_hints: ['architect'],
          tool_rules: [
            {
              tool_name: 'Edit',
              action: 'block',
              conditions: [],
            },
          ],
        },
        {
          name: 'execute',
          context: 'Implement the feature',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
        {
          name: 'review',
          context: 'Review the code',
          agent_hints: ['code-reviewer'],
          tool_rules: [
            {
              tool_name: 'Write',
              action: 'block',
              conditions: [],
            },
            {
              tool_name: 'Bash',
              action: 'warn',
              conditions: [],
            },
          ],
        },
      ];

      const workflow: WorkflowConfig = {
        name: 'feature',
        description: 'Feature development',
        default_phase: 'design',
        phases: phases,
        transitions: [],
      };

      const result = formatPhaseEnforcement(workflow);

      expect(result).toContain('### design');
      expect(result).toContain('- **Blocked**: Edit');
      expect(result).toContain('### execute');
      expect(result).toContain('- All tools allowed');
      expect(result).toContain('### review');
      expect(result).toContain('- **Blocked**: Write');
      expect(result).toContain('- **Warned**: Bash');
    });
  });

  describe('formatWorkflowContext', () => {
    it('returns empty string for null workflow', () => {
      const result = formatWorkflowContext(null);
      expect(result).toBe('');
    });

    it('returns empty string for workflow with no phases', () => {
      const workflow: WorkflowConfig = {
        name: 'test',
        description: 'Test workflow',
        default_phase: 'execute',
        phases: [],
        transitions: [],
      };

      const result = formatWorkflowContext(workflow);
      expect(result).toBe('');
    });

    it('shows workflow with currentPhase context and valid transitions', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'design',
          context: 'Understand requirements and design the solution.\n\nExplore the codebase to find integration points.',
          agent_hints: ['architect'],
          tool_rules: [],
        },
        {
          name: 'plan',
          context: 'Create a detailed implementation plan.',
          agent_hints: ['planner'],
          tool_rules: [],
        },
        {
          name: 'execute',
          context: 'Implement the feature.',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
      ];

      const transitions: WorkflowTransition[] = [
        { from: 'design', to: 'plan' },
        { from: 'plan', to: 'execute' },
        { from: 'execute', to: 'complete' },
      ];

      const workflow: WorkflowConfig = {
        name: 'feature',
        description: 'Feature development workflow',
        default_phase: 'design',
        phases: phases,
        transitions: transitions,
      };

      const result = formatWorkflowContext(workflow, 'design');

      expect(result).toContain('## Active Workflow: feature');
      expect(result).toContain('**Phases**: design → plan → execute');
      expect(result).toContain('### Current Phase: design');
      expect(result).toContain('Understand requirements and design the solution.');
      expect(result).toContain('Explore the codebase to find integration points.');
      expect(result).toContain('### Valid Transitions from design');
      expect(result).toContain('- plan');
    });

    it('shows just phase sequence when currentPhase is not provided', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'design',
          context: 'Design the solution',
          agent_hints: ['architect'],
          tool_rules: [],
        },
        {
          name: 'execute',
          context: 'Implement',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
        {
          name: 'review',
          context: 'Review code',
          agent_hints: ['code-reviewer'],
          tool_rules: [],
        },
      ];

      const workflow: WorkflowConfig = {
        name: 'bug-fix',
        description: 'Bug fix workflow',
        default_phase: 'execute',
        phases: phases,
        transitions: [],
      };

      const result = formatWorkflowContext(workflow);

      expect(result).toContain('## Active Workflow: bug-fix');
      expect(result).toContain('**Phases**: design → execute → review');
      expect(result).not.toContain('### Current Phase:');
      expect(result).not.toContain('### Valid Transitions');
    });

    it('shows phase sequence but no current phase section when currentPhase not found', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'design',
          context: 'Design the solution',
          agent_hints: ['architect'],
          tool_rules: [],
        },
        {
          name: 'execute',
          context: 'Implement',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
      ];

      const workflow: WorkflowConfig = {
        name: 'test',
        description: 'Test workflow',
        default_phase: 'design',
        phases: phases,
        transitions: [],
      };

      const result = formatWorkflowContext(workflow, 'nonexistent-phase');

      expect(result).toContain('## Active Workflow: test');
      expect(result).toContain('**Phases**: design → execute');
      expect(result).not.toContain('### Current Phase:');
      expect(result).not.toContain('### Valid Transitions');
    });

    it('handles phase with no context gracefully', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'execute',
          context: '',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
      ];

      const transitions: WorkflowTransition[] = [
        { from: 'execute', to: 'complete' },
      ];

      const workflow: WorkflowConfig = {
        name: 'minimal',
        description: 'Minimal workflow',
        default_phase: 'execute',
        phases: phases,
        transitions: transitions,
      };

      const result = formatWorkflowContext(workflow, 'execute');

      expect(result).toContain('## Active Workflow: minimal');
      expect(result).toContain('### Current Phase: execute');
      expect(result).toContain('### Valid Transitions from execute');
      expect(result).toContain('- complete');
    });

    it('handles currentPhase with no outgoing transitions', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'execute',
          context: 'Do the work',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
        {
          name: 'complete',
          context: 'Task complete',
          agent_hints: [],
          tool_rules: [],
        },
      ];

      const transitions: WorkflowTransition[] = [
        { from: 'execute', to: 'complete' },
      ];

      const workflow: WorkflowConfig = {
        name: 'simple',
        description: 'Simple workflow',
        default_phase: 'execute',
        phases: phases,
        transitions: transitions,
      };

      const result = formatWorkflowContext(workflow, 'complete');

      expect(result).toContain('## Active Workflow: simple');
      expect(result).toContain('### Current Phase: complete');
      expect(result).toContain('Task complete');
      expect(result).not.toContain('### Valid Transitions from complete');
    });

    it('handles multiple valid transitions from current phase', () => {
      const phases: WorkflowPhaseConfig[] = [
        {
          name: 'execute',
          context: 'Implement the feature',
          agent_hints: ['code-agent'],
          tool_rules: [],
        },
        {
          name: 'test',
          context: 'Test the feature',
          agent_hints: ['tdd-guide'],
          tool_rules: [],
        },
        {
          name: 'review',
          context: 'Review the code',
          agent_hints: ['code-reviewer'],
          tool_rules: [],
        },
      ];

      const transitions: WorkflowTransition[] = [
        { from: 'execute', to: 'test' },
        { from: 'execute', to: 'review' },
        { from: 'execute', to: 'complete' },
      ];

      const workflow: WorkflowConfig = {
        name: 'flexible',
        description: 'Flexible workflow',
        default_phase: 'execute',
        phases: phases,
        transitions: transitions,
      };

      const result = formatWorkflowContext(workflow, 'execute');

      expect(result).toContain('### Valid Transitions from execute');
      expect(result).toContain('- test');
      expect(result).toContain('- review');
      expect(result).toContain('- complete');
    });

    // Regression tests for workflow phase awareness fix
    describe('regression: agent_hints on transitions and remaining phases warning', () => {
      const buildMultiPhaseWorkflow = (): WorkflowConfig => ({
        name: 'feature',
        description: 'Feature workflow',
        default_phase: 'execute',
        phases: [
          {
            name: 'execute',
            context: 'Implement the feature',
            agent_hints: ['code-agent'],
            tool_rules: [],
          },
          {
            name: 'review',
            context: 'Review the code',
            agent_hints: ['code-reviewer'],
            tool_rules: [],
          },
          {
            name: 'merge-cleanup',
            context: 'Merge and clean up',
            agent_hints: ['merge-cleanup'],
            tool_rules: [],
          },
        ],
        transitions: [
          { from: 'execute', to: 'review' },
          { from: 'review', to: 'merge-cleanup' },
        ],
      });

      it('shows agent_hints on valid transitions — spawn one of: <hints>', () => {
        const workflow = buildMultiPhaseWorkflow();
        const result = formatWorkflowContext(workflow, 'execute');

        // The transition to "review" should include agent_hints for that phase
        expect(result).toContain('review — spawn one of: code-reviewer');
      });

      it('shows remaining phases section when phases exist after current', () => {
        const workflow = buildMultiPhaseWorkflow();
        const result = formatWorkflowContext(workflow, 'execute');

        expect(result).toContain('**Remaining phases**: review → merge-cleanup');
      });

      it('shows mandatory warning to complete all remaining phases', () => {
        const workflow = buildMultiPhaseWorkflow();
        const result = formatWorkflowContext(workflow, 'execute');

        expect(result).toContain('You MUST complete all remaining phases before finishing');
      });

      it('shows "To advance to <phase>" instructions for each remaining phase', () => {
        const workflow = buildMultiPhaseWorkflow();
        const result = formatWorkflowContext(workflow, 'execute');

        expect(result).toContain('To advance to `review`');
        expect(result).toContain('To advance to `merge-cleanup`');
      });

      it('lists agent hints for each remaining phase in "To advance" instructions', () => {
        const workflow = buildMultiPhaseWorkflow();
        const result = formatWorkflowContext(workflow, 'execute');

        expect(result).toContain('spawn one of these agents: code-reviewer');
        expect(result).toContain('spawn one of these agents: merge-cleanup');
      });

      it('shows "(see phase context)" when agent_hints is empty for a remaining phase', () => {
        const workflow: WorkflowConfig = {
          name: 'test',
          description: 'Test workflow',
          default_phase: 'execute',
          phases: [
            {
              name: 'execute',
              context: 'Do the work',
              agent_hints: ['code-agent'],
              tool_rules: [],
            },
            {
              name: 'complete',
              context: 'Task complete',
              agent_hints: [],
              tool_rules: [],
            },
          ],
          transitions: [{ from: 'execute', to: 'complete' }],
        };

        const result = formatWorkflowContext(workflow, 'execute');

        expect(result).toContain('To advance to `complete`');
        expect(result).toContain('(see phase context)');
      });

      it('does not show remaining phases section when current phase is last', () => {
        const workflow = buildMultiPhaseWorkflow();
        const result = formatWorkflowContext(workflow, 'merge-cleanup');

        expect(result).not.toContain('**Remaining phases**:');
        expect(result).not.toContain('You MUST complete all remaining phases');
      });

      it('does not show agent_hints annotation when transition target has no hints', () => {
        const workflow: WorkflowConfig = {
          name: 'test',
          description: 'Test workflow',
          default_phase: 'execute',
          phases: [
            {
              name: 'execute',
              context: 'Do the work',
              agent_hints: ['code-agent'],
              tool_rules: [],
            },
            {
              name: 'complete',
              context: 'Done',
              agent_hints: [],
              tool_rules: [],
            },
          ],
          transitions: [{ from: 'execute', to: 'complete' }],
        };

        const result = formatWorkflowContext(workflow, 'execute');

        // "complete" transition should NOT show "spawn one of: " because hints is empty
        expect(result).toContain('- complete');
        expect(result).not.toMatch(/- complete — spawn one of:/);
      });

      it('shows multiple agent_hints joined with comma in transition annotation', () => {
        const workflow: WorkflowConfig = {
          name: 'test',
          description: 'Test workflow',
          default_phase: 'execute',
          phases: [
            {
              name: 'execute',
              context: 'Implement',
              agent_hints: ['code-agent'],
              tool_rules: [],
            },
            {
              name: 'test',
              context: 'Test',
              agent_hints: ['tdd-guide', 'e2e-runner'],
              tool_rules: [],
            },
          ],
          transitions: [{ from: 'execute', to: 'test' }],
        };

        const result = formatWorkflowContext(workflow, 'execute');

        expect(result).toContain('test — spawn one of: tdd-guide, e2e-runner');
      });
    });
  });
});
