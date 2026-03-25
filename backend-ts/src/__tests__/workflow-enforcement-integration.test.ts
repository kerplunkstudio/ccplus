import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

/**
 * Integration test for workflow phase enforcement
 *
 * Verifies the complete flow:
 * 1. Socket handler extracts workflow parameter
 * 2. Workflow state is initialized with correct default_phase
 * 3. Hooks correctly enforce phase rules
 */

// Mock config module before importing workflow-state
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    WORKFLOWS_DIR: path.join(tmpdir(), `ccplus-test-integration-${Date.now()}`),
  };
});

import * as config from '../config.js';
import { getWorkflowState, evaluatePreToolUse, skipToPhase, transitionPhase } from '../workflow-state.js';
import { loadWorkflow } from '../workflow-config.js';

const TEST_WORKFLOWS_DIR = config.WORKFLOWS_DIR;

describe('Workflow enforcement integration', () => {
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

  it('enforces design phase rules when feature workflow is used', () => {
    const sessionId = 'integration-test-1';
    const workflowName = 'feature';

    // Step 1: Load workflow config
    const workflowConfig = loadWorkflow(workflowName);
    expect(workflowConfig.name).toBe('feature');
    expect(workflowConfig.default_phase).toBe('design');

    // Step 2: Initialize workflow state (simulating what streamQuery does)
    const state = getWorkflowState(sessionId, workflowName);
    expect(state.phase).toBe('design');
    expect(state.workflowName).toBe('feature');

    // Step 3: Verify phase enforcement for Edit tool in design phase
    const result = evaluatePreToolUse(
      state.phase,
      'Edit',
      { file_path: '/test/src/app.ts' },
      workflowConfig
    );

    // Feature workflow blocks Edit in design phase
    expect(result.action).toBe('block');
  });

  it('enforces plan phase rules when feature workflow is used', () => {
    const sessionId = 'integration-test-2';
    const workflowName = 'feature';

    // Load workflow and initialize state at plan phase
    const workflowConfig = loadWorkflow(workflowName);
    skipToPhase(sessionId, 'plan');

    const state = getWorkflowState(sessionId, workflowName);
    expect(state.phase).toBe('plan');

    // Verify phase enforcement for Write tool in plan phase
    const result = evaluatePreToolUse(
      state.phase,
      'Write',
      { file_path: '/test/src/feature.ts' },
      workflowConfig
    );

    // Feature workflow blocks Write in plan phase
    expect(result.action).toBe('block');
  });

  it('allows code changes in execute phase', () => {
    const sessionId = 'integration-test-3';
    const workflowName = 'feature';

    const workflowConfig = loadWorkflow(workflowName);
    skipToPhase(sessionId, 'execute');

    const state = getWorkflowState(sessionId, workflowName);
    expect(state.phase).toBe('execute');

    // Verify Edit is allowed in execute phase
    const result = evaluatePreToolUse(
      state.phase,
      'Edit',
      { file_path: '/test/src/feature.ts' },
      workflowConfig
    );

    expect(result.action).toBe('allow');
  });

  it('blocks code changes in review phase', () => {
    const sessionId = 'integration-test-4';
    const workflowName = 'feature';

    const workflowConfig = loadWorkflow(workflowName);
    skipToPhase(sessionId, 'review');

    const state = getWorkflowState(sessionId, workflowName);
    expect(state.phase).toBe('review');

    // Verify Edit is blocked in review phase
    const result = evaluatePreToolUse(
      state.phase,
      'Edit',
      { file_path: '/test/src/feature.ts' },
      workflowConfig
    );

    expect(result.action).toBe('block');
  });

  it('complete workflow flow: design -> plan -> execute -> test -> review', () => {
    const sessionId = 'integration-test-5';
    const workflowName = 'feature';
    const workflowConfig = loadWorkflow(workflowName);

    // Initialize with feature workflow - should start in design phase
    const state1 = getWorkflowState(sessionId, workflowName);
    expect(state1.phase).toBe('design');
    expect(state1.workflowName).toBe('feature');

    // Design phase: Edit should be blocked
    const designEdit = evaluatePreToolUse('design', 'Edit', { file_path: '/test/app.ts' }, workflowConfig);
    expect(designEdit.action).toBe('block');

    // Read should be allowed
    const designRead = evaluatePreToolUse('design', 'Read', { file_path: '/test/app.ts' }, workflowConfig);
    expect(designRead.action).toBe('allow');

    // Transition to plan
    const state2 = transitionPhase(sessionId, 'plan', 'user_approved_design');
    expect(state2).not.toBeNull();
    expect(state2?.phase).toBe('plan');

    // Plan phase: Write should be blocked
    const planWrite = evaluatePreToolUse('plan', 'Write', { file_path: '/test/feature.ts' }, workflowConfig);
    expect(planWrite.action).toBe('block');

    // Transition to execute
    const state3 = transitionPhase(sessionId, 'execute', 'plan_approved');
    expect(state3?.phase).toBe('execute');

    // Execute phase: Edit should be allowed
    const executeEdit = evaluatePreToolUse('execute', 'Edit', { file_path: '/test/feature.ts' }, workflowConfig);
    expect(executeEdit.action).toBe('allow');

    // Transition to test
    const state4 = transitionPhase(sessionId, 'test', 'implementation_complete');
    expect(state4?.phase).toBe('test');

    // Transition to review
    const state5 = transitionPhase(sessionId, 'review', 'tests_passing');
    expect(state5?.phase).toBe('review');

    // Review phase: Edit should be blocked
    const reviewEdit = evaluatePreToolUse('review', 'Edit', { file_path: '/test/feature.ts' }, workflowConfig);
    expect(reviewEdit.action).toBe('block');
  });
});
