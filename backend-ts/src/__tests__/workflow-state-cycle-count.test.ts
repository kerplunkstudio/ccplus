import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

/**
 * Regression tests for countWorkflowCycles() added to workflow-state.ts.
 *
 * Feature: Loop detection — count how many times a specific from→to transition
 * has occurred in a session so hooks.ts can warn when merge→execute cycles
 * exceed a safe threshold.
 */

// ---- Mocks ----

vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    WORKFLOWS_DIR: path.join(tmpdir(), `ccplus-test-cycle-count-${Date.now()}`),
  };
});

vi.mock('../workflow-config.js', async () => {
  const actual = await vi.importActual('../workflow-config.js') as any;

  const testWorkflow = {
    name: 'default',
    description: 'Test workflow',
    default_phase: 'execute',
    transitions: [
      { from: 'execute', to: 'review' },
      { from: 'review', to: 'merge' },
      { from: 'merge', to: 'execute' },
      { from: 'review', to: 'execute' },
    ],
    phases: [
      { name: 'execute', context: 'Execute', agent_hints: [], tool_rules: [] },
      { name: 'review', context: 'Review', agent_hints: [], tool_rules: [] },
      { name: 'merge', context: 'Merge', agent_hints: [], tool_rules: [] },
    ],
  };

  return {
    ...actual,
    loadWorkflow: (_name: string) => testWorkflow,
  };
});

import * as config from '../config.js';
const TEST_WORKFLOWS_DIR = config.WORKFLOWS_DIR;

import {
  getWorkflowState,
  skipToPhase,
  countWorkflowCycles,
} from '../workflow-state.js';

// ---- Tests ----

describe('countWorkflowCycles', () => {
  beforeEach(() => {
    if (!existsSync(TEST_WORKFLOWS_DIR)) {
      mkdirSync(TEST_WORKFLOWS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_WORKFLOWS_DIR)) {
      rmSync(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
    }
  });

  it('returns 0 when no transitions exist for a new session', () => {
    const count = countWorkflowCycles('new-session-cycle-001', 'merge', 'execute');
    expect(count).toBe(0);
  });

  it('returns 0 when transitions exist but none match the requested from→to pair', () => {
    const sessionId = 'session-no-match-002';
    // Adds a execute→review transition
    skipToPhase(sessionId, 'review');
    // Adds a review→execute transition
    skipToPhase(sessionId, 'execute');

    // Asking for merge→execute — none of those happened
    const count = countWorkflowCycles(sessionId, 'merge', 'execute');
    expect(count).toBe(0);
  });

  it('returns correct count for a single matching merge→execute transition', () => {
    const sessionId = 'session-single-cycle-003';
    skipToPhase(sessionId, 'merge');
    skipToPhase(sessionId, 'execute'); // this produces merge→execute

    const count = countWorkflowCycles(sessionId, 'merge', 'execute');
    expect(count).toBe(1);
  });

  it('returns correct count when merge→execute transition occurs multiple times', () => {
    const sessionId = 'session-multi-cycle-004';
    // Three full merge→execute round-trips
    skipToPhase(sessionId, 'merge');
    skipToPhase(sessionId, 'execute');
    skipToPhase(sessionId, 'merge');
    skipToPhase(sessionId, 'execute');
    skipToPhase(sessionId, 'merge');
    skipToPhase(sessionId, 'execute');

    const count = countWorkflowCycles(sessionId, 'merge', 'execute');
    expect(count).toBe(3);
  });

  it('ignores other transition types when counting merge→execute', () => {
    const sessionId = 'session-mixed-transitions-005';
    // Interleave other transitions that should not be counted
    skipToPhase(sessionId, 'review');   // execute→review
    skipToPhase(sessionId, 'execute');  // review→execute
    skipToPhase(sessionId, 'merge');    // execute→merge
    skipToPhase(sessionId, 'execute');  // merge→execute  ← only this should count

    const count = countWorkflowCycles(sessionId, 'merge', 'execute');
    expect(count).toBe(1);
  });

  it('counts transitions independently per session', () => {
    const sessionA = 'session-cycle-A-006';
    const sessionB = 'session-cycle-B-007';

    // Session A gets 2 merge→execute cycles
    skipToPhase(sessionA, 'merge');
    skipToPhase(sessionA, 'execute');
    skipToPhase(sessionA, 'merge');
    skipToPhase(sessionA, 'execute');

    // Session B gets 1 merge→execute cycle
    skipToPhase(sessionB, 'merge');
    skipToPhase(sessionB, 'execute');

    expect(countWorkflowCycles(sessionA, 'merge', 'execute')).toBe(2);
    expect(countWorkflowCycles(sessionB, 'merge', 'execute')).toBe(1);
  });

  it('returns 0 for a direction that never occurred (execute→merge counted separately)', () => {
    const sessionId = 'session-direction-008';
    skipToPhase(sessionId, 'merge'); // produces execute→merge
    skipToPhase(sessionId, 'execute'); // produces merge→execute

    // execute→merge should be 1, merge→execute should be 1
    expect(countWorkflowCycles(sessionId, 'execute', 'merge')).toBe(1);
    expect(countWorkflowCycles(sessionId, 'merge', 'execute')).toBe(1);
    // review→execute should be 0 — never happened
    expect(countWorkflowCycles(sessionId, 'review', 'execute')).toBe(0);
  });

  it('getWorkflowState still returns the full transition history after cycles', () => {
    const sessionId = 'session-history-009';
    skipToPhase(sessionId, 'review');
    skipToPhase(sessionId, 'merge');
    skipToPhase(sessionId, 'execute');

    const state = getWorkflowState(sessionId);
    expect(state.transitions).toHaveLength(3);
    expect(state.transitions[2].from).toBe('merge');
    expect(state.transitions[2].to).toBe('execute');
  });
});
