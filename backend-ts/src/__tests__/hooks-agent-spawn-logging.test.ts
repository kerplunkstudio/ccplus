import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression tests for agent spawn logging added to hooks.ts.
 *
 * Feature 1 – preToolUse logs [AGENT SPAWN]:
 *   When the Agent/Task tool is invoked and the input contains subagent_type
 *   or description, hooks.ts must call log.info with the tag "[AGENT SPAWN]"
 *   and include agentType, description, workspace, and sessionId.
 *
 * Feature 2 – postToolUseFailure logs [AGENT SPAWN FAILURE]:
 *   When an Agent/Task tool invocation fails, hooks.ts must call log.error
 *   with the tag "[AGENT SPAWN FAILURE]" and include agentType, error details,
 *   workspace, and sessionId.
 */

// ---- Mocks ----

vi.mock('../workflow-state.js', () => ({
  getWorkflowState: vi.fn(),
  inferPhaseFromAgent: vi.fn().mockReturnValue(null),
  transitionPhase: vi.fn(),
  getNextPhase: vi.fn().mockReturnValue(null),
  evaluatePreToolUse: vi.fn().mockReturnValue({ action: 'allow' }),
  getPhaseContext: vi.fn().mockReturnValue(null),
  countWorkflowCycles: vi.fn().mockReturnValue(0),
}));

vi.mock('../workflow-config.js', () => ({
  loadWorkflow: vi.fn().mockReturnValue(null),
}));

vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    WORKFLOW_ENABLED: false,
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
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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
import { log } from '../logger.js';

// ---- Helpers ----

const SESSION_ID = 'test-session-agent-spawn-logging';
const WORKSPACE = '/test/workspace';

function makeSession() {
  return {
    callbacks: {
      onToolEvent: vi.fn(),
      onSignal: vi.fn(),
    },
    hadToolSinceLastText: false,
    latestTodos: undefined,
    workspace: WORKSPACE,
  };
}

// ---- Tests ----

describe('hooks: agent spawn logging', () => {
  beforeEach(() => {
    sessions.set(SESSION_ID, makeSession() as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    sessions.delete(SESSION_ID);
  });

  describe('preToolUse — [AGENT SPAWN] logging', () => {
    it('logs [AGENT SPAWN] when subagent_type is present', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-spawn-001',
          tool_input: {
            subagent_type: 'code-agent',
            description: 'Implement the feature',
          },
          agent_id: 'parent-agent-id',
        },
        'tu-spawn-001',
      );

      const infoCallsWithSpawnTag = vi.mocked(log).info.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(infoCallsWithSpawnTag.length).toBeGreaterThan(0);
    });

    it('[AGENT SPAWN] log includes agentType in context', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-spawn-002',
          tool_input: { subagent_type: 'tdd-guide', description: 'Write tests' },
          agent_id: 'parent-agent-id',
        },
        'tu-spawn-002',
      );

      const spawnCall = vi.mocked(log).info.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(spawnCall).toBeDefined();
      const context = spawnCall![1] as Record<string, unknown>;
      expect(context.agentType).toBe('tdd-guide');
    });

    it('[AGENT SPAWN] log includes sessionId in context', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-spawn-003',
          tool_input: { subagent_type: 'planner', description: 'Plan it' },
          agent_id: 'parent-agent-id',
        },
        'tu-spawn-003',
      );

      const spawnCall = vi.mocked(log).info.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(spawnCall).toBeDefined();
      const context = spawnCall![1] as Record<string, unknown>;
      expect(context.sessionId).toBe(SESSION_ID);
    });

    it('[AGENT SPAWN] log includes workspace in context', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-spawn-004',
          tool_input: { subagent_type: 'code-reviewer', description: 'Review it' },
          agent_id: 'parent-agent-id',
        },
        'tu-spawn-004',
      );

      const spawnCall = vi.mocked(log).info.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(spawnCall).toBeDefined();
      const context = spawnCall![1] as Record<string, unknown>;
      expect(context.workspace).toBe(WORKSPACE);
    });

    it('logs [AGENT SPAWN] when description is present (even without subagent_type)', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-spawn-005',
          tool_input: { description: 'Do something useful' },
          agent_id: 'parent-agent-id',
        },
        'tu-spawn-005',
      );

      const infoCallsWithSpawnTag = vi.mocked(log).info.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(infoCallsWithSpawnTag.length).toBeGreaterThan(0);
    });

    it('does NOT log [AGENT SPAWN] for non-agent tools (e.g. Bash)', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Bash',
          tool_use_id: 'tu-bash-006',
          tool_input: { command: 'npm test' },
          agent_id: 'parent-agent-id',
        },
        'tu-bash-006',
      );

      const infoCallsWithSpawnTag = vi.mocked(log).info.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(infoCallsWithSpawnTag.length).toBe(0);
    });

    it('does NOT log [AGENT SPAWN] when Agent tool has neither subagent_type nor description', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-spawn-007',
          tool_input: { prompt: 'do stuff' }, // no subagent_type, no description
          agent_id: 'parent-agent-id',
        },
        'tu-spawn-007',
      );

      const infoCallsWithSpawnTag = vi.mocked(log).info.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(infoCallsWithSpawnTag.length).toBe(0);
    });

    it('[AGENT SPAWN] log defaults agentType to "default" when subagent_type is absent but description is present', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const preToolUseHook = hooks.PreToolUse[0].hooks[0];

      await preToolUseHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-spawn-008',
          tool_input: { description: 'Do something' }, // no subagent_type
          agent_id: 'parent-agent-id',
        },
        'tu-spawn-008',
      );

      const spawnCall = vi.mocked(log).info.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN]'),
      );
      expect(spawnCall).toBeDefined();
      const context = spawnCall![1] as Record<string, unknown>;
      expect(context.agentType).toBe('default');
    });
  });

  describe('postToolUseFailure — [AGENT SPAWN FAILURE] logging', () => {
    it('logs [AGENT SPAWN FAILURE] when an Agent tool fails', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const postToolUseFailureHook = hooks.PostToolUseFailure[0].hooks[0];

      await postToolUseFailureHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-fail-001',
          tool_input: { subagent_type: 'code-agent', description: 'Implement feature' },
          agent_id: 'parent-agent-id',
          error: new Error('Spawn failed: out of memory'),
        },
        'tu-fail-001',
      );

      const errorCallsWithFailureTag = vi.mocked(log).error.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN FAILURE]'),
      );
      expect(errorCallsWithFailureTag.length).toBeGreaterThan(0);
    });

    it('[AGENT SPAWN FAILURE] log includes agentType in context', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const postToolUseFailureHook = hooks.PostToolUseFailure[0].hooks[0];

      await postToolUseFailureHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-fail-002',
          tool_input: { subagent_type: 'tdd-guide', description: 'Write tests' },
          agent_id: 'parent-agent-id',
          error: 'Connection timeout',
        },
        'tu-fail-002',
      );

      const failureCall = vi.mocked(log).error.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN FAILURE]'),
      );
      expect(failureCall).toBeDefined();
      const context = failureCall![1] as Record<string, unknown>;
      expect(context.agentType).toBe('tdd-guide');
    });

    it('[AGENT SPAWN FAILURE] log includes sessionId in context', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const postToolUseFailureHook = hooks.PostToolUseFailure[0].hooks[0];

      await postToolUseFailureHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-fail-003',
          tool_input: { subagent_type: 'planner', description: 'Plan it' },
          agent_id: 'parent-agent-id',
          error: 'Unexpected error',
        },
        'tu-fail-003',
      );

      const failureCall = vi.mocked(log).error.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN FAILURE]'),
      );
      expect(failureCall).toBeDefined();
      const context = failureCall![1] as Record<string, unknown>;
      expect(context.sessionId).toBe(SESSION_ID);
    });

    it('[AGENT SPAWN FAILURE] log includes error details in context', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const postToolUseFailureHook = hooks.PostToolUseFailure[0].hooks[0];

      const testError = new Error('Sandbox creation failed');

      await postToolUseFailureHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-fail-004',
          tool_input: { subagent_type: 'code-agent', description: 'Implement' },
          agent_id: 'parent-agent-id',
          error: testError,
        },
        'tu-fail-004',
      );

      const failureCall = vi.mocked(log).error.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN FAILURE]'),
      );
      expect(failureCall).toBeDefined();
      const context = failureCall![1] as Record<string, unknown>;
      expect(context.error).toBe('Sandbox creation failed');
    });

    it('[AGENT SPAWN FAILURE] log includes workspace in context', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const postToolUseFailureHook = hooks.PostToolUseFailure[0].hooks[0];

      await postToolUseFailureHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-fail-005',
          tool_input: { subagent_type: 'code-agent', description: 'Implement' },
          agent_id: 'parent-agent-id',
          error: 'Some error',
        },
        'tu-fail-005',
      );

      const failureCall = vi.mocked(log).error.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN FAILURE]'),
      );
      expect(failureCall).toBeDefined();
      const context = failureCall![1] as Record<string, unknown>;
      expect(context.workspace).toBe(WORKSPACE);
    });

    it('does NOT log [AGENT SPAWN FAILURE] for non-agent tool failures', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const postToolUseFailureHook = hooks.PostToolUseFailure[0].hooks[0];

      await postToolUseFailureHook(
        {
          tool_name: 'Bash',
          tool_use_id: 'tu-bash-fail-006',
          tool_input: { command: 'npm test' },
          agent_id: 'parent-agent-id',
          error: 'Command not found',
        },
        'tu-bash-fail-006',
      );

      const errorCallsWithFailureTag = vi.mocked(log).error.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN FAILURE]'),
      );
      expect(errorCallsWithFailureTag.length).toBe(0);
    });

    it('[AGENT SPAWN FAILURE] defaults agentType to "unknown" when subagent_type is absent', async () => {
      const hooks = buildHooks(SESSION_ID, WORKSPACE);
      const postToolUseFailureHook = hooks.PostToolUseFailure[0].hooks[0];

      await postToolUseFailureHook(
        {
          tool_name: 'Agent',
          tool_use_id: 'tu-fail-007',
          tool_input: { description: 'Do something' }, // no subagent_type
          agent_id: 'parent-agent-id',
          error: 'Error without type',
        },
        'tu-fail-007',
      );

      const failureCall = vi.mocked(log).error.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[AGENT SPAWN FAILURE]'),
      );
      expect(failureCall).toBeDefined();
      const context = failureCall![1] as Record<string, unknown>;
      expect(context.agentType).toBe('unknown');
    });
  });
});
