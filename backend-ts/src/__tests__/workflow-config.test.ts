import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  loadWorkflow,
  listWorkflows,
  getValidTransitions,
  getPhaseConfig,
  evaluateToolRule,
  DEFAULT_WORKFLOW,
  FEATURE_WORKFLOW,
  DEBUG_WORKFLOW,
  TDD_WORKFLOW,
  HOTFIX_WORKFLOW,
  type ToolRule,
} from '../workflow-config.js';

describe('workflow-config', () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = path.join(tmpdir(), `ccplus-test-workspace-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  describe('Built-in Workflows', () => {
    it('loads DEFAULT_WORKFLOW correctly', () => {
      const workflow = loadWorkflow('default', testWorkspace);
      expect(workflow.name).toBe('default');
      expect(workflow.phases.length).toBe(7); // idle, design, plan, execute, test, review, complete
      expect(workflow.transitions.length).toBe(7);
    });

    it('DEFAULT_WORKFLOW has correct phases', () => {
      expect(DEFAULT_WORKFLOW.phases.map(p => p.name)).toEqual([
        'idle', 'design', 'plan', 'execute', 'test', 'review', 'complete'
      ]);
    });

    it('DEFAULT_WORKFLOW blocks EnterPlanMode in all phases', () => {
      for (const phase of DEFAULT_WORKFLOW.phases) {
        const enterPlanRule = phase.tool_rules?.find(r => r.tool_name === 'EnterPlanMode');
        if (enterPlanRule) {
          expect(enterPlanRule.action).toBe('block');
          expect(enterPlanRule.message).toContain('planner');
        }
      }
    });

    it('DEFAULT_WORKFLOW has correct idle phase blocking rules', () => {
      const idlePhase = DEFAULT_WORKFLOW.phases.find(p => p.name === 'idle');
      expect(idlePhase).toBeDefined();
      const editRule = idlePhase!.tool_rules?.find(r => r.tool_name === 'Edit');
      expect(editRule).toBeDefined();
      expect(editRule!.action).toBe('block');
      expect(editRule!.conditions?.file_path_excludes).toContain('plan');
      expect(editRule!.conditions?.file_path_excludes).toContain('doc');
    });

    it('DEFAULT_WORKFLOW has correct review phase git commit blocking', () => {
      const reviewPhase = DEFAULT_WORKFLOW.phases.find(p => p.name === 'review');
      expect(reviewPhase).toBeDefined();
      const bashRule = reviewPhase!.tool_rules?.find(r => r.tool_name === 'Bash');
      expect(bashRule).toBeDefined();
      expect(bashRule!.action).toBe('block');
      expect(bashRule!.conditions?.command_contains).toContain('git commit');
    });

    it('loads FEATURE_WORKFLOW', () => {
      const workflow = loadWorkflow('feature', testWorkspace);
      expect(workflow.name).toBe('feature');
      expect(workflow.phases.length).toBeGreaterThan(0);
    });

    it('loads DEBUG_WORKFLOW', () => {
      const workflow = loadWorkflow('debug', testWorkspace);
      expect(workflow.name).toBe('debug');
      expect(workflow.phases.map(p => p.name)).toContain('execute');
    });

    it('loads TDD_WORKFLOW', () => {
      const workflow = loadWorkflow('tdd', testWorkspace);
      expect(workflow.name).toBe('tdd');
      expect(workflow.phases.map(p => p.name)).toContain('test');
    });

    it('loads HOTFIX_WORKFLOW', () => {
      const workflow = loadWorkflow('hotfix', testWorkspace);
      expect(workflow.name).toBe('hotfix');
      expect(workflow.phases.length).toBe(4); // idle, execute, review, complete
    });
  });

  describe('loadWorkflow', () => {
    it('returns built-in workflow when no custom config exists', () => {
      const workflow = loadWorkflow('default', testWorkspace);
      expect(workflow).toBeDefined();
      expect(workflow.name).toBe('default');
    });

    it('loads project-specific YAML workflow', () => {
      const workflowDir = path.join(testWorkspace, '.ccplus', 'workflows', 'custom');
      mkdirSync(workflowDir, { recursive: true });

      const customWorkflow = {
        name: 'custom',
        phases: [
          { name: 'start', tool_rules: [] },
          { name: 'end', tool_rules: [] },
        ],
        transitions: [
          { from: 'start', to: ['end'] },
        ],
      };

      writeFileSync(
        path.join(workflowDir, 'workflow.yaml'),
        `name: custom
phases:
  - name: start
    tool_rules: []
  - name: end
    tool_rules: []
transitions:
  - from: start
    to:
      - end
`,
        'utf-8'
      );

      const workflow = loadWorkflow('custom', testWorkspace);
      expect(workflow.name).toBe('custom');
      expect(workflow.phases.length).toBe(2);
      expect(workflow.phases[0].name).toBe('start');
    });

    it('falls back to default when workflow not found', () => {
      const workflow = loadWorkflow('nonexistent', testWorkspace);
      expect(workflow.name).toBe('default');
    });

    it('caches loaded workflows', () => {
      const workflow1 = loadWorkflow('default', testWorkspace);
      const workflow2 = loadWorkflow('default', testWorkspace);
      expect(workflow1).toBe(workflow2); // Same object reference
    });
  });

  describe('listWorkflows', () => {
    it('includes all built-in workflows', () => {
      const workflows = listWorkflows(testWorkspace);
      expect(workflows).toContain('default');
      expect(workflows).toContain('feature');
      expect(workflows).toContain('debug');
      expect(workflows).toContain('tdd');
      expect(workflows).toContain('hotfix');
    });

    it('includes project-specific workflows', () => {
      const workflowDir = path.join(testWorkspace, '.ccplus', 'workflows', 'custom-project');
      mkdirSync(workflowDir, { recursive: true });
      writeFileSync(
        path.join(workflowDir, 'workflow.yaml'),
        'name: custom-project\nphases: []\ntransitions: []',
        'utf-8'
      );

      const workflows = listWorkflows(testWorkspace);
      expect(workflows).toContain('custom-project');
    });
  });

  describe('getValidTransitions', () => {
    it('returns valid transitions for idle phase', () => {
      const transitions = getValidTransitions(DEFAULT_WORKFLOW, 'idle');
      expect(transitions).toEqual(['design', 'plan', 'execute']);
    });

    it('returns valid transitions for execute phase', () => {
      const transitions = getValidTransitions(DEFAULT_WORKFLOW, 'execute');
      expect(transitions).toEqual(['test', 'review']);
    });

    it('returns empty array for unknown phase', () => {
      const transitions = getValidTransitions(DEFAULT_WORKFLOW, 'unknown');
      expect(transitions).toEqual([]);
    });
  });

  describe('getPhaseConfig', () => {
    it('returns phase config for valid phase', () => {
      const config = getPhaseConfig(DEFAULT_WORKFLOW, 'execute');
      expect(config).toBeDefined();
      expect(config!.name).toBe('execute');
      expect(config!.context).toContain('WORKFLOW PHASE: EXECUTE');
    });

    it('returns null for unknown phase', () => {
      const config = getPhaseConfig(DEFAULT_WORKFLOW, 'unknown');
      expect(config).toBeNull();
    });

    it('returns phase with agent_hints', () => {
      const config = getPhaseConfig(DEFAULT_WORKFLOW, 'plan');
      expect(config).toBeDefined();
      expect(config!.agent_hints).toContain('planner');
      expect(config!.agent_hints).toContain('architect');
    });
  });

  describe('evaluateToolRule', () => {
    it('matches when no conditions specified', () => {
      const rule: ToolRule = {
        tool_name: 'Edit',
        action: 'warn',
        message: 'Test',
      };
      const result = evaluateToolRule(rule, { file_path: 'src/app.ts' });
      expect(result).toBe(true);
    });

    it('matches when file_path does not match exclusion pattern', () => {
      const rule: ToolRule = {
        tool_name: 'Edit',
        action: 'block',
        conditions: {
          file_path_excludes: ['test', 'spec'],
        },
      };
      const result = evaluateToolRule(rule, { file_path: 'src/app.ts' });
      expect(result).toBe(true);
    });

    it('does not match when file_path matches exclusion pattern', () => {
      const rule: ToolRule = {
        tool_name: 'Edit',
        action: 'block',
        conditions: {
          file_path_excludes: ['test', 'spec'],
        },
      };
      const result = evaluateToolRule(rule, { file_path: 'src/__tests__/app.test.ts' });
      expect(result).toBe(false); // Excluded because path contains 'test'
    });

    it('matches when command contains required pattern', () => {
      const rule: ToolRule = {
        tool_name: 'Bash',
        action: 'block',
        conditions: {
          command_contains: ['git commit'],
        },
      };
      const result = evaluateToolRule(rule, { command: 'git commit -m "test"' });
      expect(result).toBe(true);
    });

    it('does not match when command does not contain required pattern', () => {
      const rule: ToolRule = {
        tool_name: 'Bash',
        action: 'block',
        conditions: {
          command_contains: ['git commit'],
        },
      };
      const result = evaluateToolRule(rule, { command: 'npm test' });
      expect(result).toBe(false);
    });

    it('handles multiple exclusion patterns', () => {
      const rule: ToolRule = {
        tool_name: 'Edit',
        action: 'warn',
        conditions: {
          file_path_excludes: ['plan', 'doc', 'README'],
        },
      };

      expect(evaluateToolRule(rule, { file_path: 'src/app.ts' })).toBe(true);
      expect(evaluateToolRule(rule, { file_path: 'docs/plan.md' })).toBe(false);
      expect(evaluateToolRule(rule, { file_path: 'README.md' })).toBe(false);
    });
  });

  describe('DEFAULT_WORKFLOW matches current behavior', () => {
    it('blocks editing source files in idle phase', () => {
      const idlePhase = DEFAULT_WORKFLOW.phases.find(p => p.name === 'idle');
      const editRule = idlePhase!.tool_rules?.find(r => r.tool_name === 'Edit');

      expect(evaluateToolRule(editRule!, { file_path: 'src/app.ts' })).toBe(true); // Blocked
      expect(evaluateToolRule(editRule!, { file_path: 'docs/plan.md' })).toBe(false); // Allowed
      expect(evaluateToolRule(editRule!, { file_path: 'README.md' })).toBe(false); // Allowed
    });

    it('warns when editing non-plan files in plan phase', () => {
      const planPhase = DEFAULT_WORKFLOW.phases.find(p => p.name === 'plan');
      const editRule = planPhase!.tool_rules?.find(r => r.tool_name === 'Edit');

      expect(editRule!.action).toBe('warn');
      expect(evaluateToolRule(editRule!, { file_path: 'src/app.ts' })).toBe(true); // Warns
      expect(evaluateToolRule(editRule!, { file_path: 'docs/plan.md' })).toBe(false); // No warning
    });

    it('warns when editing non-test files in test phase', () => {
      const testPhase = DEFAULT_WORKFLOW.phases.find(p => p.name === 'test');
      const editRule = testPhase!.tool_rules?.find(r => r.tool_name === 'Edit');

      expect(editRule!.action).toBe('warn');
      expect(evaluateToolRule(editRule!, { file_path: 'src/app.ts' })).toBe(true); // Warns
      expect(evaluateToolRule(editRule!, { file_path: 'src/__tests__/app.test.ts' })).toBe(false); // No warning
    });

    it('blocks git commit in review phase', () => {
      const reviewPhase = DEFAULT_WORKFLOW.phases.find(p => p.name === 'review');
      const bashRule = reviewPhase!.tool_rules?.find(r => r.tool_name === 'Bash');

      expect(bashRule!.action).toBe('block');
      expect(evaluateToolRule(bashRule!, { command: 'git commit -m "test"' })).toBe(true); // Blocked
      expect(evaluateToolRule(bashRule!, { command: 'npm test' })).toBe(false); // Not blocked
    });
  });
});
