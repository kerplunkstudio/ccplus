import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

// Mock config module before importing workflow-state
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    WORKFLOWS_DIR: path.join(tmpdir(), `ccplus-test-workflows-${Date.now()}`),
  };
});

// Mock workflow-config module to provide test workflows
vi.mock('../workflow-config.js', async () => {
  const actual = await vi.importActual('../workflow-config.js') as any;

  const testDefaultWorkflow = {
    name: 'default',
    description: 'Test default workflow',
    default_phase: 'execute',
    transitions: [
      { from: 'execute', to: 'review' },
      { from: 'review', to: 'merge' },
      { from: 'merge', to: 'complete' },
      { from: 'review', to: 'execute' },
    ],
    phases: [
      {
        name: 'execute',
        context: 'Execute phase',
        agent_hints: [],
        tool_rules: [
          { tool_name: 'Bash', action: 'block', conditions: ['command_contains:git commit'], message: 'Execute phase: complete code review before committing' },
        ],
      },
      {
        name: 'review',
        context: 'Review phase',
        agent_hints: [],
        tool_rules: [
          { tool_name: 'Edit', action: 'block', conditions: [], message: 'Review phase: report findings, do not edit code' },
          { tool_name: 'Write', action: 'block', conditions: [], message: 'Review phase: report findings, do not write new files' },
        ],
      },
      { name: 'merge', context: 'Merge phase', agent_hints: [], tool_rules: [] },
      { name: 'complete', context: 'Complete phase', agent_hints: [], tool_rules: [] },
    ],
  };

  const testFeatureWorkflow = {
    name: 'feature',
    description: 'Test feature workflow',
    default_phase: 'design',
    transitions: [
      { from: 'design', to: 'plan' },
      { from: 'plan', to: 'execute' },
      { from: 'execute', to: 'test' },
      { from: 'test', to: 'review' },
      { from: 'review', to: 'complete' },
      { from: 'test', to: 'execute' },
      { from: 'review', to: 'execute' },
    ],
    phases: [
      { name: 'design', context: 'Design phase', agent_hints: [], tool_rules: [] },
      { name: 'plan', context: 'Plan phase', agent_hints: [], tool_rules: [] },
      { name: 'execute', context: 'Execute phase', agent_hints: [], tool_rules: [] },
      { name: 'test', context: 'Test phase', agent_hints: [], tool_rules: [] },
      { name: 'review', context: 'Review phase', agent_hints: [], tool_rules: [] },
      { name: 'complete', context: 'Complete phase', agent_hints: [], tool_rules: [] },
    ],
  };

  return {
    ...actual,
    loadWorkflow: (workflowName: string) => {
      if (workflowName === 'feature') return testFeatureWorkflow;
      return testDefaultWorkflow; // default for all others
    },
  };
});

import * as config from '../config.js';
const TEST_WORKFLOWS_DIR = config.WORKFLOWS_DIR;

import {
  getWorkflowState,
  transitionPhase,
  skipToPhase,
  evaluatePreToolUse,
  getPhaseContext,
  inferPhaseFromAgent,
  resetWorkflow,
  type WorkflowPhase,
} from '../workflow-state.js';
import type { WorkflowConfig } from '../workflow-config.js';

describe('workflow-state', () => {
  // Mock workflow for testing tool rules, context, and agent hints
  const mockWorkflow: WorkflowConfig = {
    name: 'test-workflow',
    description: 'Test workflow for unit tests',
    default_phase: 'design',
    phases: [
      {
        name: 'design',
        context: 'WORKFLOW PHASE: DESIGN\n\nYou are in the design phase. Focus on architecture and planning.\n\nDo NOT write implementation code yet.',
        agent_hints: ['architect'],
        tool_rules: [
          { tool_name: 'Edit', action: 'warn', conditions: [], message: 'Design phase: consider finalizing your design before writing code' },
          { tool_name: 'Write', action: 'warn', conditions: [], message: 'Design phase: consider finalizing your design before writing code' },
        ],
      },
      {
        name: 'plan',
        context: 'WORKFLOW PHASE: PLAN\n\nYou are in the planning phase. Create detailed implementation plans.',
        agent_hints: ['planner'],
        tool_rules: [
          { tool_name: 'Edit', action: 'warn', conditions: ['file_path_not_contains:plan,doc'], message: 'Plan phase: implementation should wait until planning is complete' },
          { tool_name: 'Write', action: 'warn', conditions: ['file_path_not_contains:plan,doc'], message: 'Plan phase: implementation should wait until planning is complete' },
        ],
      },
      {
        name: 'execute',
        context: 'WORKFLOW PHASE: EXECUTE\n\nYou are in the execution phase. Implement the planned features.',
        agent_hints: ['code_agent', 'frontend-agent', 'build-error-resolver'],
        tool_rules: [
          { tool_name: 'Bash', action: 'block', conditions: ['command_contains:git commit'], message: 'Execute phase: complete code review before committing' },
        ],
      },
      {
        name: 'test',
        context: 'WORKFLOW PHASE: TEST\n\nYou are in the testing phase. Write and run tests.',
        agent_hints: ['tdd-guide', 'e2e-runner'],
        tool_rules: [
          { tool_name: 'Edit', action: 'warn', conditions: ['file_path_not_contains:test,spec,__tests__'], message: 'Test phase: focus on writing tests' },
          { tool_name: 'Write', action: 'warn', conditions: ['file_path_not_contains:test,spec,__tests__'], message: 'Test phase: focus on writing tests' },
        ],
      },
      {
        name: 'review',
        context: 'WORKFLOW PHASE: REVIEW\n\nYou are in the review phase. Review code and provide feedback.',
        agent_hints: ['code-reviewer', 'security-reviewer'],
        tool_rules: [
          { tool_name: 'Edit', action: 'block', conditions: [], message: 'Review phase: report findings, do not edit code' },
          { tool_name: 'Write', action: 'block', conditions: [], message: 'Review phase: report findings, do not edit code' },
          { tool_name: 'Bash', action: 'block', conditions: ['command_contains:git commit'], message: 'Cannot commit during review phase' },
        ],
      },
    ],
    transitions: [
      { from: 'design', to: 'plan' },
      { from: 'plan', to: 'execute' },
      { from: 'execute', to: 'test' },
      { from: 'test', to: 'review' },
      { from: 'review', to: 'complete' },
      { from: 'test', to: 'execute' },
      { from: 'review', to: 'execute' },
    ],
  };

  beforeEach(() => {
    // Create temp directory for test session state files
    if (!existsSync(TEST_WORKFLOWS_DIR)) {
      mkdirSync(TEST_WORKFLOWS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(TEST_WORKFLOWS_DIR)) {
      rmSync(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
    }
  });

  describe('getWorkflowState', () => {
    it('returns default workflow state for nonexistent session', () => {
      const state = getWorkflowState('new-session-123');
      // Default workflow has default_phase 'execute'
      expect(state.phase).toBe('execute');
      expect(state.transitions).toEqual([]);
      expect(state.sessionId).toBe('new-session-123');
      expect(state.createdAt).toBeDefined();
    });

    it('returns persisted state if file exists', () => {
      const sessionId = 'test-session-456';
      // Create a state first - skip to review since default workflow starts at execute
      skipToPhase(sessionId, 'review');

      // Read it back
      const state2 = getWorkflowState(sessionId);
      expect(state2.phase).toBe('review');
      expect(state2.transitions.length).toBe(1);
    });
  });

  describe('transitionPhase', () => {
    it('succeeds for valid transition: execute -> review', () => {
      const state = transitionPhase('session-1', 'review', 'user_request');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('review');
      expect(state!.transitions.length).toBe(1);
      expect(state!.transitions[0].from).toBe('execute');
      expect(state!.transitions[0].to).toBe('review');
      expect(state!.transitions[0].trigger).toBe('user_request');
    });

    it('fails for invalid transition: execute -> design', () => {
      const state = transitionPhase('session-2', 'design', 'invalid');
      expect(state).toBeNull();
    });

    it('succeeds for valid transition: review -> merge', () => {
      const sessionId = 'session-3';
      // Setup: skip to review phase first
      skipToPhase(sessionId, 'review');

      // Now test the transition
      const state = transitionPhase(sessionId, 'merge', 'merge_ready');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('merge');
    });

    it('allows review -> execute transition (back to fix)', () => {
      const sessionId = 'session-4';
      skipToPhase(sessionId, 'review');

      const state = transitionPhase(sessionId, 'execute', 'fix_issues');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('execute');
    });

    it('allows review -> execute transition (back to fix)', () => {
      const sessionId = 'session-5';
      skipToPhase(sessionId, 'review');

      const state = transitionPhase(sessionId, 'execute', 'address_review');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('execute');
    });
  });

  describe('skipToPhase', () => {
    it('allows skipping to any phase bypassing validation', () => {
      const state = skipToPhase('session-skip', 'review');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('review');
      expect(state!.transitions.length).toBe(1);
      expect(state!.transitions[0].trigger).toBe('manual_skip');
      // Default workflow starts at 'execute'
      expect(state!.transitions[0].from).toBe('execute');
      expect(state!.transitions[0].to).toBe('review');
    });
  });

  describe('evaluatePreToolUse', () => {
    it('warns in design phase when using Edit', () => {
      const result = evaluatePreToolUse('design', 'Edit', { file_path: 'src/app.ts' }, mockWorkflow);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Design phase');
    });

    it('allows Read in design phase', () => {
      const result = evaluatePreToolUse('design', 'Read', { file_path: 'src/app.ts' }, mockWorkflow);
      expect(result.action).toBe('allow');
    });

    it('allows Edit in execute phase without git commit', () => {
      const result = evaluatePreToolUse('execute', 'Edit', { file_path: 'src/app.ts' }, mockWorkflow);
      expect(result.action).toBe('allow');
    });

    it('blocks git commit in execute phase', () => {
      const result = evaluatePreToolUse('execute', 'Bash', { command: 'git commit -m "test"' }, mockWorkflow);
      expect(result.action).toBe('block');
      expect(result.message).toContain('Execute phase');
    });

    it('blocks git commit in review phase', () => {
      const result = evaluatePreToolUse('review', 'Bash', { command: 'git commit -m "test"' }, mockWorkflow);
      expect(result.action).toBe('block');
      expect(result.message).toContain('Cannot commit during review');
    });

    it('allows npm test in review phase', () => {
      const result = evaluatePreToolUse('review', 'Bash', { command: 'npm test' }, mockWorkflow);
      expect(result.action).toBe('allow');
    });

    it('allows editing test files in test phase', () => {
      const result = evaluatePreToolUse('test', 'Edit', { file_path: 'src/__tests__/app.test.ts' }, mockWorkflow);
      expect(result.action).toBe('allow');
    });

    it('warns when editing non-test files in test phase', () => {
      const result = evaluatePreToolUse('test', 'Edit', { file_path: 'src/app.ts' }, mockWorkflow);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Test phase');
    });

    it('allows editing plan files in plan phase', () => {
      const result = evaluatePreToolUse('plan', 'Write', { file_path: 'docs/plan.md' }, mockWorkflow);
      expect(result.action).toBe('allow');
    });

    it('warns when editing non-plan files in plan phase', () => {
      const result = evaluatePreToolUse('plan', 'Write', { file_path: 'src/app.ts' }, mockWorkflow);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Plan phase');
    });

    it('blocks Edit in review phase', () => {
      const result = evaluatePreToolUse('review', 'Edit', { file_path: 'src/app.ts' }, mockWorkflow);
      expect(result.action).toBe('block');
      expect(result.message).toContain('Review phase');
    });

    it('blocks EnterPlanMode in all phases (platform-level rule)', () => {
      const phases: WorkflowPhase[] = ['idle', 'design', 'plan', 'execute', 'test', 'review', 'complete'];
      for (const phase of phases) {
        const result = evaluatePreToolUse(phase, 'EnterPlanMode', {}, null);
        expect(result.action).toBe('block');
        expect(result.message).toContain('planner');
      }
    });
  });

  describe('getPhaseContext', () => {
    it('returns string for design phase', () => {
      const context = getPhaseContext('design', mockWorkflow);
      expect(context).toBeDefined();
      expect(context).toContain('WORKFLOW PHASE: DESIGN');
      expect(context).toContain('Do NOT write implementation code');
    });

    it('returns null for idle phase', () => {
      const context = getPhaseContext('idle', mockWorkflow);
      expect(context).toBeNull();
    });

    it('returns string for execute phase', () => {
      const context = getPhaseContext('execute', mockWorkflow);
      expect(context).toBeDefined();
      expect(context).toContain('WORKFLOW PHASE: EXECUTE');
    });
  });

  describe('inferPhaseFromAgent', () => {
    it('infers execute for code_agent', () => {
      const phase = inferPhaseFromAgent('code_agent', mockWorkflow);
      expect(phase).toBe('execute');
    });

    it('infers plan for planner', () => {
      const phase = inferPhaseFromAgent('planner', mockWorkflow);
      expect(phase).toBe('plan');
    });

    it('infers test for tdd-guide', () => {
      const phase = inferPhaseFromAgent('tdd-guide', mockWorkflow);
      expect(phase).toBe('test');
    });

    it('infers review for code-reviewer', () => {
      const phase = inferPhaseFromAgent('code-reviewer', mockWorkflow);
      expect(phase).toBe('review');
    });

    it('returns null for unknown agent', () => {
      const phase = inferPhaseFromAgent('unknown-agent', mockWorkflow);
      expect(phase).toBeNull();
    });

    it('infers execute for frontend-agent', () => {
      const phase = inferPhaseFromAgent('frontend-agent', mockWorkflow);
      expect(phase).toBe('execute');
    });

    it('infers design for architect', () => {
      const phase = inferPhaseFromAgent('architect', mockWorkflow);
      expect(phase).toBe('design');
    });
  });

  describe('resetWorkflow', () => {
    it('returns default workflow state', () => {
      const sessionId = 'reset-session';
      // First transition to another state
      skipToPhase(sessionId, 'review');

      // Reset
      const state = resetWorkflow(sessionId);
      expect(state).not.toBeNull();
      // Default workflow has default_phase 'execute'
      expect(state!.phase).toBe('execute');
      expect(state!.transitions).toEqual([]);
    });
  });

  describe('state persistence', () => {
    it('writes and reads state correctly', () => {
      const sessionId = 'persist-test';
      const state1 = transitionPhase(sessionId, 'review', 'test_trigger');
      expect(state1).not.toBeNull();

      // Read it back
      const state2 = getWorkflowState(sessionId);
      expect(state2.phase).toBe('review');
      expect(state2.transitions.length).toBe(1);
      expect(state2.transitions[0].from).toBe('execute');
      expect(state2.transitions[0].to).toBe('review');
      expect(state2.transitions[0].trigger).toBe('test_trigger');
    });

    it('accumulates transitions over multiple phase changes', () => {
      const sessionId = 'multi-transition';
      skipToPhase(sessionId, 'design');
      skipToPhase(sessionId, 'plan');
      skipToPhase(sessionId, 'execute');

      const state = getWorkflowState(sessionId);
      expect(state.phase).toBe('execute');
      expect(state.transitions.length).toBe(3);
      expect(state.transitions[0].to).toBe('design');
      expect(state.transitions[1].to).toBe('plan');
      expect(state.transitions[2].to).toBe('execute');
    });
  });

  describe('sanitization', () => {
    it('handles session IDs with special characters', () => {
      const sessionId = 'test/session:123@special';
      const state = getWorkflowState(sessionId);
      // Default workflow has default_phase 'execute'
      expect(state.phase).toBe('execute');
      expect(state.sessionId).toBe(sessionId);

      // File is now created immediately when getWorkflowState is called (Bug Fix #3)
      const files = readdirSync(TEST_WORKFLOWS_DIR);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^testsession123special\.json$/);

      // Now write to a different phase
      const newState = skipToPhase(sessionId, 'review');
      expect(newState).not.toBeNull();
      expect(newState!.phase).toBe('review');

      // File should still exist with the same sanitized name
      const filesAfter = readdirSync(TEST_WORKFLOWS_DIR);
      expect(filesAfter.length).toBe(1);
      expect(filesAfter[0]).toMatch(/^testsession123special\.json$/);
    });
  });

  describe('migration', () => {
    it('adds workflowName to state without it', () => {
      const sessionId = 'migration-test';
      const statePath = path.join(TEST_WORKFLOWS_DIR, `${sessionId}.json`);

      // Write old state format (without workflowName)
      const oldState = {
        phase: 'execute',
        transitions: [],
        sessionId,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(statePath, JSON.stringify(oldState, null, 2), 'utf-8');

      // Read it back - should add workflowName
      const state = getWorkflowState(sessionId);
      expect(state.workflowName).toBe('default');
      expect(state.phase).toBe('execute');
    });
  });

  describe('workflow default_phase initialization (Bug Fix #2)', () => {
    it('creates state with default_phase from workflow config when workflow is feature', () => {
      const sessionId = 'feature-workflow-test';
      // Get state with workflow name 'feature' - should initialize with design phase
      const state = getWorkflowState(sessionId, 'feature');
      expect(state.phase).toBe('design');
      expect(state.workflowName).toBe('feature');
    });

    it('creates state with execute phase for default workflow', () => {
      const sessionId = 'default-workflow-test';
      const state = getWorkflowState(sessionId, 'default');
      // Default workflow has default_phase 'execute'
      expect(state.phase).toBe('execute');
      expect(state.workflowName).toBe('default');
    });

    it('creates state with execute phase when no workflow specified', () => {
      const sessionId = 'no-workflow-test';
      const state = getWorkflowState(sessionId);
      // Default workflow has default_phase 'execute'
      expect(state.phase).toBe('execute');
      expect(state.workflowName).toBe('default');
    });
  });
});

