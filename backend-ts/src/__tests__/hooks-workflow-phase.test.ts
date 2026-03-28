import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression test suite for hooks.ts workflow_phase signal fix.
 *
 * Bug: PostToolUse agent_complete block emitted workflow_phase signal
 * WITHOUT agent_hints — the field was present in SubagentStart but
 * missing from the agent_complete path.
 *
 * Fix: The PostToolUse block now includes agent_hints in the
 * workflow_phase signal data, matching the SubagentStart behavior.
 */

// ---- Mocks ----

vi.mock('../workflow-state.js', () => ({
  getWorkflowState: vi.fn(),
  inferPhaseFromAgent: vi.fn(),
  transitionPhase: vi.fn(),
  getNextPhase: vi.fn(),
  evaluatePreToolUse: vi.fn(),
  getPhaseContext: vi.fn(),
}));

vi.mock('../workflow-config.js', () => ({
  loadWorkflow: vi.fn(),
}));

vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    WORKFLOW_ENABLED: true,
    getMemoryEnabled: vi.fn().mockReturnValue(false),
    getDistillationEnabled: vi.fn().mockReturnValue(false),
  };
});

vi.mock('../database.js', () => ({
  recordToolEvent: vi.fn(),
  updateToolEvent: vi.fn(),
  recordDistillation: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../fleet-monitor.js', () => ({
  incrementToolCount: vi.fn(),
  incrementAgentCount: vi.fn(),
  decrementAgentCount: vi.fn(),
  addFileTouched: vi.fn(),
}));

vi.mock('../memory-client.js', () => ({
  searchMemories: vi.fn().mockResolvedValue(''),
  storeMemory: vi.fn().mockResolvedValue(undefined),
}));

// ---- Imports (after mocks) ----

import { buildHooks } from '../sdk/hooks.js';
import { sessions } from '../sdk/session-manager.js';
import {
  getWorkflowState,
  inferPhaseFromAgent,
  transitionPhase,
  getNextPhase,
} from '../workflow-state.js';
import { loadWorkflow } from '../workflow-config.js';

// ---- Helpers ----

const SESSION_ID = 'test-session-hooks-regression';

function makeSession(onSignal: (...args: any[]) => void) {
  return {
    callbacks: {
      onToolEvent: vi.fn(),
      onSignal,
    },
    hadToolSinceLastText: false,
    latestTodos: undefined,
    workspace: '/test/workspace',
  };
}

const MOCK_WORKFLOW = {
  name: 'feature',
  description: 'Feature workflow',
  default_phase: 'execute',
  phases: [
    {
      name: 'execute',
      context: 'Implement',
      agent_hints: ['code-agent'],
      tool_rules: [],
    },
    {
      name: 'review',
      context: 'Review',
      agent_hints: ['code-reviewer'],
      tool_rules: [],
    },
    {
      name: 'merge-cleanup',
      context: 'Merge',
      agent_hints: ['merge-cleanup'],
      tool_rules: [],
    },
  ],
  transitions: [
    { from: 'execute', to: 'review' },
    { from: 'review', to: 'merge-cleanup' },
  ],
};

// ---- Tests ----

describe('hooks workflow_phase signal regression', () => {
  let capturedSignals: any[];

  beforeEach(() => {
    capturedSignals = [];
    sessions.set(SESSION_ID, makeSession((signal: any) => capturedSignals.push(signal)) as any);

    vi.mocked(loadWorkflow).mockReturnValue(MOCK_WORKFLOW as any);

    vi.mocked(getWorkflowState).mockReturnValue({
      sessionId: SESSION_ID,
      workflowName: 'feature',
      phase: 'execute',
      transitions: [],
      createdAt: '2024-01-01',
    });

    vi.mocked(inferPhaseFromAgent).mockReturnValue('execute');

    vi.mocked(getNextPhase).mockReturnValue('review');

    vi.mocked(transitionPhase).mockReturnValue({
      sessionId: SESSION_ID,
      workflowName: 'feature',
      phase: 'review',
      transitions: [],
      createdAt: '2024-01-01',
    });
  });

  afterEach(() => {
    sessions.delete(SESSION_ID);
    vi.clearAllMocks();
  });

  describe('PostToolUse agent_complete: workflow_phase signal includes agent_hints', () => {
    it('emits workflow_phase signal when agent completes and phase transitions', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');
      const postToolUseHook = hooks.PostToolUse[0].hooks[0];

      await postToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-001',
          tool_input: { subagent_type: 'code-agent', prompt: 'Implement the feature' },
          agent_id: 'agent-001',
        },
        'tu-001',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
    });

    it('workflow_phase signal from agent_complete contains agent_hints field', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');
      const postToolUseHook = hooks.PostToolUse[0].hooks[0];

      await postToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-002',
          tool_input: { subagent_type: 'code-agent', prompt: 'Implement' },
          agent_id: 'agent-002',
        },
        'tu-002',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      // The fix: agent_hints must be present in the signal data
      expect(phaseSignal.data).toHaveProperty('agent_hints');
    });

    it('workflow_phase signal agent_hints matches hints from the next phase', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');
      const postToolUseHook = hooks.PostToolUse[0].hooks[0];

      await postToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-003',
          tool_input: { subagent_type: 'code-agent', prompt: 'Implement' },
          agent_id: 'agent-003',
        },
        'tu-003',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      // Next phase is 'review', whose agent_hints is ['code-reviewer']
      expect(phaseSignal.data.agent_hints).toEqual(['code-reviewer']);
    });

    it('workflow_phase signal includes phase and previous fields alongside agent_hints', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');
      const postToolUseHook = hooks.PostToolUse[0].hooks[0];

      await postToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-004',
          tool_input: { subagent_type: 'code-agent', prompt: 'Implement' },
          agent_id: 'agent-004',
        },
        'tu-004',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      expect(phaseSignal.data.phase).toBe('review');
      expect(phaseSignal.data.previous).toBe('execute');
      expect(phaseSignal.data.sessionId).toBe(SESSION_ID);
      expect(phaseSignal.data.agent_hints).toEqual(['code-reviewer']);
    });

    it('does not emit workflow_phase signal when no phase transition occurs', async () => {
      // No matching phase inferred — agent type does not map to current phase
      vi.mocked(inferPhaseFromAgent).mockReturnValue(null);

      const hooks = buildHooks(SESSION_ID, '/test/workspace');
      const postToolUseHook = hooks.PostToolUse[0].hooks[0];

      await postToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-005',
          tool_input: { subagent_type: 'unknown-agent', prompt: 'Do stuff' },
          agent_id: 'agent-005',
        },
        'tu-005',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeUndefined();
    });

    it('agent_hints is empty array when next phase has no hints', async () => {
      // Override workflow so "review" phase has no agent_hints
      const workflowNoHints = {
        ...MOCK_WORKFLOW,
        phases: MOCK_WORKFLOW.phases.map((p) =>
          p.name === 'review' ? { ...p, agent_hints: [] } : p,
        ),
      };
      vi.mocked(loadWorkflow).mockReturnValue(workflowNoHints as any);

      const hooks = buildHooks(SESSION_ID, '/test/workspace');
      const postToolUseHook = hooks.PostToolUse[0].hooks[0];

      await postToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-006',
          tool_input: { subagent_type: 'code-agent', prompt: 'Implement' },
          agent_id: 'agent-006',
        },
        'tu-006',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      // agent_hints must still be present — as an empty array, not undefined
      expect(phaseSignal.data.agent_hints).toEqual([]);
    });
  });
});
