import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

/**
 * Test suite for Bug Fix #3: Workflow state initialization in streamQuery
 *
 * Verifies that when a workflow parameter is provided to streamQuery,
 * the workflow state file is initialized with the correct workflow name
 * and default_phase before hooks run.
 */

// Mock config module before importing workflow-state
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    WORKFLOWS_DIR: path.join(tmpdir(), `ccplus-test-stream-query-${Date.now()}`),
  };
});

import * as config from '../config.js';
import { getWorkflowState } from '../workflow-state.js';

const TEST_WORKFLOWS_DIR = config.WORKFLOWS_DIR;

describe('streamQuery workflow initialization (Bug Fix #3)', () => {
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

  it('initializes workflow state with correct workflow name and default_phase', async () => {
    const sessionId = 'test-stream-session-1';
    const workflow = 'feature';

    // Simulate what streamQuery does - call getWorkflowState with workflow parameter
    const state = getWorkflowState(sessionId, workflow);

    // Verify state was initialized correctly
    expect(state.sessionId).toBe(sessionId);
    expect(state.workflowName).toBe('feature');
    expect(state.phase).toBe('design'); // feature workflow default_phase is 'design'
    expect(state.transitions).toEqual([]);
  });

  it('initializes workflow state with execute phase for default workflow', async () => {
    const sessionId = 'test-stream-session-2';
    const workflow = 'default';

    const state = getWorkflowState(sessionId, workflow);

    expect(state.sessionId).toBe(sessionId);
    expect(state.workflowName).toBe('default');
    // Default workflow has default_phase 'execute', but our logic uses 'idle' as fallback for 'default'
    // This test verifies the actual behavior: default workflow should load its default_phase
    expect(state.phase).toBe('execute');
  });

  it('does not override existing workflow state', async () => {
    const sessionId = 'test-stream-session-3';

    // First query with feature workflow
    const state1 = getWorkflowState(sessionId, 'feature');
    expect(state1.phase).toBe('design');
    expect(state1.workflowName).toBe('feature');

    // Second query should load existing state, not create new one
    const state2 = getWorkflowState(sessionId, 'feature');
    expect(state2.phase).toBe('design');
    expect(state2.workflowName).toBe('feature');
    expect(state2.createdAt).toBe(state1.createdAt);
  });

  it('preserves workflow state across multiple getWorkflowState calls', async () => {
    const sessionId = 'test-stream-session-4';
    const workflow = 'tdd';

    // First call creates state
    const state1 = getWorkflowState(sessionId, workflow);
    expect(state1.workflowName).toBe('tdd');

    // Second call should return the same state
    const state2 = getWorkflowState(sessionId, workflow);
    expect(state2.workflowName).toBe('tdd');
    expect(state2.phase).toBe(state1.phase);
  });
});
