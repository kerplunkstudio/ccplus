import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for review-gate: when code-reviewer completes with a BLOCK verdict,
 * the workflow transitions back to `execute` instead of forward to `merge`.
 *
 * Bug: Auto-transition in PostToolUse hook called getNextPhase() unconditionally,
 * ignoring the reviewer's last message. This caused review→merge even when the
 * reviewer issued a BLOCK verdict with CRITICAL or HIGH issues.
 *
 * Fix: In backend-ts/src/sdk/hooks.ts, the PostToolUse handler now checks
 * stopData.lastMessage for a BLOCK verdict when inferredPhase is 'review'.
 * If found, it transitions to 'execute' instead of 'merge'.
 */

// ---- Mocks ----

vi.mock('../workflow-state.js', () => ({
  getWorkflowState: vi.fn(),
  inferPhaseFromAgent: vi.fn(),
  transitionPhase: vi.fn(),
  getNextPhase: vi.fn(),
  evaluatePreToolUse: vi.fn().mockReturnValue({ action: 'allow' }),
  getPhaseContext: vi.fn().mockReturnValue(null),
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

const SESSION_ID = 'test-session-review-gate';

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
  name: 'default',
  description: 'Default workflow',
  default_phase: 'execute',
  phases: [
    {
      name: 'execute',
      context: 'Implement',
      agent_hints: ['code_agent', 'frontend-agent'],
      tool_rules: [],
    },
    {
      name: 'review',
      context: 'Review',
      agent_hints: ['code-reviewer'],
      tool_rules: [],
    },
    {
      name: 'merge',
      context: 'Merge',
      agent_hints: ['merge-cleanup'],
      tool_rules: [],
    },
  ],
  transitions: [
    { from: 'execute', to: 'review' },
    { from: 'review', to: 'merge' },
    { from: 'review', to: 'execute' },
    { from: 'merge', to: 'complete' },
  ],
};

// Simulates SubagentStop storing lastMessage before PostToolUse fires.
// In production the SubagentStop hook runs before PostToolUse and populates
// agentStopData via agentIdToToolUseId. In tests we drive PostToolUse directly,
// so we must also call SubagentStop to populate the internal stop-data map.
async function driveReviewerAgent(
  hooks: ReturnType<typeof buildHooks>,
  toolUseId: string,
  agentId: string,
  lastMessage: string,
) {
  // 1. PreToolUse: registers the pending agent tool-use id
  const preHook = hooks.PreToolUse[0].hooks[0];
  await preHook(
    {
      tool_name: 'Agent',
      tool_use_id: toolUseId,
      tool_input: { subagent_type: 'code-reviewer', description: 'Review the diff' },
      agent_id: 'parent-agent',
    },
    toolUseId,
  );

  // 2. SubagentStart: maps agentId → toolUseId
  const subagentStartHook = hooks.SubagentStart[0].hooks[0];
  await subagentStartHook({
    agent_id: agentId,
    agent_type: 'code-reviewer',
    tool_input: { description: 'Review the diff', prompt: '' },
  });

  // 3. SubagentStop: stores lastMessage keyed by toolUseId
  const subagentStopHook = hooks.SubagentStop[0].hooks[0];
  await subagentStopHook({
    agent_id: agentId,
    agent_type: 'code-reviewer',
    last_assistant_message: lastMessage,
    tool_input: { description: 'Review the diff', prompt: '' },
  });

  // 4. PostToolUse: triggers the auto-transition logic
  const postHook = hooks.PostToolUse[0].hooks[0];
  await postHook(
    {
      tool_name: 'Agent',
      tool_use_id: toolUseId,
      tool_input: { subagent_type: 'code-reviewer', description: 'Review the diff' },
      agent_id: 'parent-agent',
    },
    toolUseId,
  );
}

// ---- Tests ----

describe('hooks review-gate: verdict-based phase transition', () => {
  let capturedSignals: any[];
  let capturedTransitions: Array<{ to: string; trigger: string }>;

  beforeEach(() => {
    capturedSignals = [];
    capturedTransitions = [];

    sessions.set(SESSION_ID, makeSession((signal: any) => capturedSignals.push(signal)) as any);

    vi.mocked(loadWorkflow).mockReturnValue(MOCK_WORKFLOW as any);

    vi.mocked(getWorkflowState).mockReturnValue({
      sessionId: SESSION_ID,
      workflowName: 'default',
      phase: 'review',
      transitions: [],
      createdAt: '2024-01-01',
    });

    // code-reviewer → infers 'review' phase
    vi.mocked(inferPhaseFromAgent).mockImplementation((agentType) =>
      agentType === 'code-reviewer' ? 'review' : null,
    );

    // Default getNextPhase returns 'merge' (the first valid forward transition)
    vi.mocked(getNextPhase).mockReturnValue('merge');

    // transitionPhase records calls and returns new state
    vi.mocked(transitionPhase).mockImplementation((_sid, toPhase, trigger) => {
      capturedTransitions.push({ to: toPhase, trigger });
      return {
        sessionId: SESSION_ID,
        workflowName: 'default',
        phase: toPhase,
        transitions: [],
        createdAt: '2024-01-01',
      };
    });
  });

  afterEach(() => {
    sessions.delete(SESSION_ID);
    vi.clearAllMocks();
  });

  describe('BLOCK verdict → transition back to execute', () => {
    it('transitions to execute when reviewer outputs BLOCK verdict', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-block-01',
        'agent-block-01',
        'Verdict: BLOCK — CRITICAL issue found: hardcoded API key at src/api.ts:12',
      );

      expect(capturedTransitions).toHaveLength(1);
      expect(capturedTransitions[0].to).toBe('execute');
    });

    it('emits workflow_phase signal with phase=execute on BLOCK verdict', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-block-02',
        'agent-block-02',
        'Verdict: BLOCK — HIGH issues must be fixed before commit.',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      expect(phaseSignal.data.phase).toBe('execute');
      expect(phaseSignal.data.previous).toBe('review');
    });

    it('emits review_blocked: true in signal data on BLOCK verdict', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-block-03',
        'agent-block-03',
        '## Review Summary\nVerdict: BLOCK — fix the CRITICAL issue first.',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      expect(phaseSignal.data.review_blocked).toBe(true);
    });

    it('uses the execute phase agent_hints in the signal on BLOCK verdict', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-block-04',
        'agent-block-04',
        'Verdict: BLOCK — SQL injection vulnerability.',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      // execute phase agent_hints should be injected into signal
      expect(phaseSignal.data.agent_hints).toEqual(['code_agent', 'frontend-agent']);
    });
  });

  describe('READY/WARNING verdict → transition to merge', () => {
    it('transitions to merge when reviewer outputs READY verdict', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-ready-01',
        'agent-ready-01',
        'Verdict: READY — no CRITICAL or HIGH issues found. Code may be committed.',
      );

      expect(capturedTransitions).toHaveLength(1);
      expect(capturedTransitions[0].to).toBe('merge');
    });

    it('transitions to merge when reviewer outputs WARNING verdict', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-warning-01',
        'agent-warning-01',
        'Verdict: WARNING — 2 HIGH issues found, merge with caution.',
      );

      expect(capturedTransitions).toHaveLength(1);
      expect(capturedTransitions[0].to).toBe('merge');
    });

    it('does not emit review_blocked on READY verdict', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-ready-02',
        'agent-ready-02',
        'Verdict: READY — clean.',
      );

      const phaseSignal = capturedSignals.find((s) => s.type === 'workflow_phase');
      expect(phaseSignal).toBeDefined();
      expect(phaseSignal.data.review_blocked).toBeUndefined();
    });

    it('transitions to merge when reviewer output is empty', async () => {
      const hooks = buildHooks(SESSION_ID, '/test/workspace');

      await driveReviewerAgent(
        hooks,
        'tu-empty-01',
        'agent-empty-01',
        '',
      );

      expect(capturedTransitions).toHaveLength(1);
      expect(capturedTransitions[0].to).toBe('merge');
    });
  });

  describe('non-reviewer agents are not affected', () => {
    it('non-reviewer agent in execute phase transitions to review normally', async () => {
      // Reset state: code_agent completing in execute phase
      vi.mocked(getWorkflowState).mockReturnValue({
        sessionId: SESSION_ID,
        workflowName: 'default',
        phase: 'execute',
        transitions: [],
        createdAt: '2024-01-01',
      });
      vi.mocked(inferPhaseFromAgent).mockImplementation((agentType) =>
        agentType === 'code_agent' ? 'execute' : null,
      );
      vi.mocked(getNextPhase).mockReturnValue('review');

      const hooks = buildHooks(SESSION_ID, '/test/workspace');
      const preHook = hooks.PreToolUse[0].hooks[0];
      await preHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-codeagent-01',
          tool_input: { subagent_type: 'code_agent', description: 'Implement feature' },
          agent_id: 'parent-agent',
        },
        'tu-codeagent-01',
      );

      const subagentStartHook = hooks.SubagentStart[0].hooks[0];
      await subagentStartHook({
        agent_id: 'codeagent-01',
        agent_type: 'code_agent',
        tool_input: { description: 'Implement feature', prompt: '' },
      });

      const subagentStopHook = hooks.SubagentStop[0].hooks[0];
      await subagentStopHook({
        agent_id: 'codeagent-01',
        agent_type: 'code_agent',
        last_assistant_message: 'Implementation complete. No BLOCK here.',
        tool_input: { description: 'Implement feature', prompt: '' },
      });

      const postHook = hooks.PostToolUse[0].hooks[0];
      await postHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-codeagent-01',
          tool_input: { subagent_type: 'code_agent', description: 'Implement feature' },
          agent_id: 'parent-agent',
        },
        'tu-codeagent-01',
      );

      // Should go to review, not loopback to execute
      expect(capturedTransitions).toHaveLength(1);
      expect(capturedTransitions[0].to).toBe('review');
    });
  });
});
