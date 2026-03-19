import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
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
    it('returns idle state for nonexistent session', () => {
      const state = getWorkflowState('new-session-123');
      expect(state.phase).toBe('idle');
      expect(state.transitions).toEqual([]);
      expect(state.sessionId).toBe('new-session-123');
      expect(state.createdAt).toBeDefined();
    });

    it('returns persisted state if file exists', () => {
      const sessionId = 'test-session-456';
      // Create a state first
      const state1 = transitionPhase(sessionId, 'design', 'test');
      expect(state1).toBeDefined();

      // Read it back
      const state2 = getWorkflowState(sessionId);
      expect(state2.phase).toBe('design');
      expect(state2.transitions.length).toBe(1);
    });
  });

  describe('transitionPhase', () => {
    it('succeeds for valid transition: idle -> design', () => {
      const state = transitionPhase('session-1', 'design', 'user_request');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('design');
      expect(state!.transitions.length).toBe(1);
      expect(state!.transitions[0].from).toBe('idle');
      expect(state!.transitions[0].to).toBe('design');
      expect(state!.transitions[0].trigger).toBe('user_request');
    });

    it('succeeds for valid transition: idle -> plan', () => {
      const state = transitionPhase('session-1a', 'plan', 'user_request');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('plan');
      expect(state!.transitions.length).toBe(1);
      expect(state!.transitions[0].from).toBe('idle');
      expect(state!.transitions[0].to).toBe('plan');
    });

    it('fails for invalid transition: idle -> review', () => {
      const state = transitionPhase('session-2', 'review', 'invalid');
      expect(state).toBeNull();
    });

    it('succeeds for valid transition: idle -> execute (small fixes skip planning)', () => {
      const state = transitionPhase('session-2a', 'execute', 'agent:code_agent');
      expect(state).not.toBeNull();
      expect(state?.phase).toBe('execute');
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
      expect(state!.transitions[0].from).toBe('idle');
      expect(state!.transitions[0].to).toBe('review');
    });
  });

  describe('evaluatePreToolUse', () => {
    it('warns in design phase when using Edit', () => {
      const result = evaluatePreToolUse('design', 'Edit', { file_path: 'src/app.ts' });
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Design phase');
    });

    it('allows Read in design phase', () => {
      const result = evaluatePreToolUse('design', 'Read', { file_path: 'src/app.ts' });
      expect(result.action).toBe('allow');
    });

    it('allows all tools in execute phase', () => {
      const result = evaluatePreToolUse('execute', 'Edit', { file_path: 'src/app.ts' });
      expect(result.action).toBe('allow');
    });

    it('blocks git commit in review phase', () => {
      const result = evaluatePreToolUse('review', 'Bash', { command: 'git commit -m "test"' });
      expect(result.action).toBe('block');
      expect(result.message).toContain('Cannot commit during review');
    });

    it('allows npm test in review phase', () => {
      const result = evaluatePreToolUse('review', 'Bash', { command: 'npm test' });
      expect(result.action).toBe('allow');
    });

    it('allows editing test files in test phase', () => {
      const result = evaluatePreToolUse('test', 'Edit', { file_path: 'src/__tests__/app.test.ts' });
      expect(result.action).toBe('allow');
    });

    it('warns when editing non-test files in test phase', () => {
      const result = evaluatePreToolUse('test', 'Edit', { file_path: 'src/app.ts' });
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Test phase');
    });

    it('allows editing plan files in plan phase', () => {
      const result = evaluatePreToolUse('plan', 'Write', { file_path: 'docs/plan.md' });
      expect(result.action).toBe('allow');
    });

    it('warns when editing non-plan files in plan phase', () => {
      const result = evaluatePreToolUse('plan', 'Write', { file_path: 'src/app.ts' });
      expect(result.action).toBe('warn');
      expect(result.message).toContain('Plan phase');
    });

    it('blocks editing source files in idle phase', () => {
      const result = evaluatePreToolUse('idle', 'Edit', { file_path: 'src/app.ts' });
      expect(result.action).toBe('block');
      expect(result.message).toContain('Idle phase');
      expect(result.message).toContain('planner agent');
    });

    it('allows editing plan/doc files in idle phase', () => {
      const result1 = evaluatePreToolUse('idle', 'Write', { file_path: 'docs/plan.md' });
      expect(result1.action).toBe('allow');

      const result2 = evaluatePreToolUse('idle', 'Write', { file_path: 'README.md' });
      expect(result2.action).toBe('allow');

      const result3 = evaluatePreToolUse('idle', 'Edit', { file_path: '.env' });
      expect(result3.action).toBe('allow');

      const result4 = evaluatePreToolUse('idle', 'Edit', { file_path: 'config.json' });
      expect(result4.action).toBe('allow');
    });

    it('allows Read tool in idle phase', () => {
      const result = evaluatePreToolUse('idle', 'Read', { file_path: 'src/app.ts' });
      expect(result.action).toBe('allow');
    });

    it('blocks EnterPlanMode in all phases', () => {
      const phases: WorkflowPhase[] = ['idle', 'design', 'plan', 'execute', 'test', 'review', 'complete'];
      for (const phase of phases) {
        const result = evaluatePreToolUse(phase, 'EnterPlanMode', {});
        expect(result.action).toBe('block');
        expect(result.message).toContain('planner');
      }
    });
  });

  describe('getPhaseContext', () => {
    it('returns string for design phase', () => {
      const context = getPhaseContext('design');
      expect(context).toBeDefined();
      expect(context).toContain('WORKFLOW PHASE: DESIGN');
      expect(context).toContain('Do NOT write implementation code');
    });

    it('returns null for idle phase', () => {
      const context = getPhaseContext('idle');
      expect(context).toBeNull();
    });

    it('returns string for execute phase', () => {
      const context = getPhaseContext('execute');
      expect(context).toBeDefined();
      expect(context).toContain('WORKFLOW PHASE: EXECUTE');
    });
  });

  describe('inferPhaseFromAgent', () => {
    it('infers execute for code_agent', () => {
      const phase = inferPhaseFromAgent('code_agent');
      expect(phase).toBe('execute');
    });

    it('infers plan for planner', () => {
      const phase = inferPhaseFromAgent('planner');
      expect(phase).toBe('plan');
    });

    it('infers test for tdd-guide', () => {
      const phase = inferPhaseFromAgent('tdd-guide');
      expect(phase).toBe('test');
    });

    it('infers review for code-reviewer', () => {
      const phase = inferPhaseFromAgent('code-reviewer');
      expect(phase).toBe('review');
    });

    it('returns null for unknown agent', () => {
      const phase = inferPhaseFromAgent('unknown-agent');
      expect(phase).toBeNull();
    });

    it('infers execute for frontend-agent', () => {
      const phase = inferPhaseFromAgent('frontend-agent');
      expect(phase).toBe('execute');
    });

    it('infers plan for architect', () => {
      const phase = inferPhaseFromAgent('architect');
      expect(phase).toBe('plan');
    });
  });

  describe('resetWorkflow', () => {
    it('returns idle state', () => {
      const sessionId = 'reset-session';
      // First transition to another state
      skipToPhase(sessionId, 'execute');

      // Reset
      const state = resetWorkflow(sessionId);
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('idle');
      expect(state!.transitions).toEqual([]);
    });
  });

  describe('state persistence', () => {
    it('writes and reads state correctly', () => {
      const sessionId = 'persist-test';
      const state1 = transitionPhase(sessionId, 'design', 'test_trigger');
      expect(state1).not.toBeNull();

      // Read it back
      const state2 = getWorkflowState(sessionId);
      expect(state2.phase).toBe('design');
      expect(state2.transitions.length).toBe(1);
      expect(state2.transitions[0].from).toBe('idle');
      expect(state2.transitions[0].to).toBe('design');
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
      expect(state.phase).toBe('idle');
      expect(state.sessionId).toBe(sessionId);

      // Should create a file with sanitized name
      const files = readdirSync(TEST_WORKFLOWS_DIR);
      expect(files.length).toBe(0); // No file created until first write

      // Now write
      const newState = skipToPhase(sessionId, 'design');
      expect(newState).not.toBeNull();
      expect(newState!.phase).toBe('design');

      // Check file was created with sanitized name
      const filesAfter = readdirSync(TEST_WORKFLOWS_DIR);
      expect(filesAfter.length).toBe(1);
      expect(filesAfter[0]).toMatch(/^testsession123special\.json$/);
    });
  });
});
