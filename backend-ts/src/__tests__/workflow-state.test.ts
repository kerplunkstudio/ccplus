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

describe('workflow-state', () => {
  beforeEach(() => {
    // Create temp directory for test
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

    it('succeeds for valid transition: execute -> test', () => {
      const sessionId = 'session-3';
      // Setup: transition to execute first
      skipToPhase(sessionId, 'execute');

      // Now test the transition
      const state = transitionPhase(sessionId, 'test', 'test_phase');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('test');
    });

    it('allows test -> execute transition (back to fix)', () => {
      const sessionId = 'session-4';
      skipToPhase(sessionId, 'test');

      const state = transitionPhase(sessionId, 'execute', 'fix_failing_test');
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
      const result = evaluatePreToolUse('design', 'Edit', { file_path: 'src/app.ts' }, null);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Design phase');
    });

    it('allows Read in design phase', () => {
      const result = evaluatePreToolUse('design', 'Read', { file_path: 'src/app.ts' }, null);
      expect(result.action).toBe('allow');
    });

    it('allows all tools in execute phase', () => {
      const result = evaluatePreToolUse('execute', 'Edit', { file_path: 'src/app.ts' }, null);
      expect(result.action).toBe('allow');
    });

    it('blocks git commit in review phase', () => {
      const result = evaluatePreToolUse('review', 'Bash', { command: 'git commit -m "test"' }, null);
      expect(result.action).toBe('block');
      expect(result.message).toContain('Cannot commit during review');
    });

    it('allows npm test in review phase', () => {
      const result = evaluatePreToolUse('review', 'Bash', { command: 'npm test' }, null);
      expect(result.action).toBe('allow');
    });

    it('allows editing test files in test phase', () => {
      const result = evaluatePreToolUse('test', 'Edit', { file_path: 'src/__tests__/app.test.ts' }, null);
      expect(result.action).toBe('allow');
    });

    it('warns when editing non-test files in test phase', () => {
      const result = evaluatePreToolUse('test', 'Edit', { file_path: 'src/app.ts' }, null);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Test phase');
    });

    it('allows editing plan files in plan phase', () => {
      const result = evaluatePreToolUse('plan', 'Write', { file_path: 'docs/plan.md' }, null);
      expect(result.action).toBe('allow');
    });

    it('warns when editing non-plan files in plan phase', () => {
      const result = evaluatePreToolUse('plan', 'Write', { file_path: 'src/app.ts' }, null);
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Plan phase');
    });

    it('blocks editing source files in idle phase', () => {
      const result = evaluatePreToolUse('idle', 'Edit', { file_path: 'src/app.ts' }, null);
      expect(result.action).toBe('block');
      expect(result.message).toContain('Idle phase');
      expect(result.message).toContain('planner agent');
    });

    it('allows editing plan/doc files in idle phase', () => {
      const result1 = evaluatePreToolUse('idle', 'Write', { file_path: 'docs/plan.md' }, null);
      expect(result1.action).toBe('allow');

      const result2 = evaluatePreToolUse('idle', 'Write', { file_path: 'README.md' }, null);
      expect(result2.action).toBe('allow');

      const result3 = evaluatePreToolUse('idle', 'Edit', { file_path: '.env' }, null);
      expect(result3.action).toBe('allow');

      const result4 = evaluatePreToolUse('idle', 'Edit', { file_path: 'config.json' }, null);
      expect(result4.action).toBe('allow');
    });

    it('allows Read tool in idle phase', () => {
      const result = evaluatePreToolUse('idle', 'Read', { file_path: 'src/app.ts' }, null);
      expect(result.action).toBe('allow');
    });

    it('blocks EnterPlanMode in all phases', () => {
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
      const context = getPhaseContext('design', null);
      expect(context).toBeDefined();
      expect(context).toContain('WORKFLOW PHASE: DESIGN');
      expect(context).toContain('Do NOT write implementation code');
    });

    it('returns null for idle phase', () => {
      const context = getPhaseContext('idle', null);
      expect(context).toBeNull();
    });

    it('returns string for execute phase', () => {
      const context = getPhaseContext('execute', null);
      expect(context).toBeDefined();
      expect(context).toContain('WORKFLOW PHASE: EXECUTE');
    });
  });

  describe('inferPhaseFromAgent', () => {
    it('infers execute for code_agent', () => {
      const phase = inferPhaseFromAgent('code_agent', null);
      expect(phase).toBe('execute');
    });

    it('infers plan for planner', () => {
      const phase = inferPhaseFromAgent('planner', null);
      expect(phase).toBe('plan');
    });

    it('infers test for tdd-guide', () => {
      const phase = inferPhaseFromAgent('tdd-guide', null);
      expect(phase).toBe('test');
    });

    it('infers review for code-reviewer', () => {
      const phase = inferPhaseFromAgent('code-reviewer', null);
      expect(phase).toBe('review');
    });

    it('returns null for unknown agent', () => {
      const phase = inferPhaseFromAgent('unknown-agent', null);
      expect(phase).toBeNull();
    });

    it('infers execute for frontend-agent', () => {
      const phase = inferPhaseFromAgent('frontend-agent', null);
      expect(phase).toBe('execute');
    });

    it('infers plan for architect', () => {
      const phase = inferPhaseFromAgent('architect', null);
      expect(phase).toBe('plan');
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

