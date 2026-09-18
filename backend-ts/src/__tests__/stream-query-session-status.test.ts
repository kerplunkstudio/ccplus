/**
 * Regression tests for session status bug fixes in stream-query.ts
 *
 * Bug 1: captain.notifySessionComplete() throwing must NOT override session status.
 *        Before fix: notifySessionComplete was inside the main try/catch, so a throw
 *        would fall through to the catch block which sets status to 'failed'.
 *        After fix: notifySessionComplete is called OUTSIDE the try/catch, so throws
 *        are swallowed locally and the status set before the finally block is preserved.
 *
 * Bug 2: When lastCompletionData.is_error is true, session status must be 'failed'.
 *        Before fix: status was unconditionally set to 'completed' regardless of is_error.
 *        After fix: status = is_error ? 'failed' : 'completed'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

// Hoist mocks to ensure they're available before module imports
const { mockQuery, mockDatabase, mockCaptain, mockExecAsync } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockDatabase = {
    recordToolEvent: vi.fn(),
    updateToolEvent: vi.fn(),
    recordMessage: vi.fn(() => ({ id: 1 })),
    updateMessage: vi.fn(),
    getLastSdkSessionId: vi.fn(() => null),
    getImage: vi.fn(() => null),
    getSessionMetadata: vi.fn(() => null),
    upsertFleetSession: vi.fn(),
    getAllFleetSessions: vi.fn(() => []),
    saveCaptainMessage: vi.fn(),
    getCaptainMessages: vi.fn(() => []),
    getLatestCaptainConversationId: vi.fn(() => null),
  };
  const mockCaptain = {
    notifySessionComplete: vi.fn(),
  };
  const mockExecAsync = vi.fn(() => Promise.reject(new Error('Not a git repository')));
  return { mockQuery, mockDatabase, mockCaptain, mockExecAsync };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: vi.fn((config: any) => config),
  tool: vi.fn((name: string, desc: string, schema: any, handler: any) => ({
    name, desc, schema, handler,
  })),
}));

vi.mock('../database.js', () => mockDatabase);

vi.mock('../captain.js', () => mockCaptain);

vi.mock('../db/workflows.js', () => ({
  getAllWorkflows: () => [],
  getWorkflowByName: (name: string) => {
    if (name === 'default') {
      return {
        name: 'default',
        description: 'Default workflow',
        default_phase: 'execute',
        phases: [{ name: 'execute', context: 'Execute phase', agent_hints: [], tool_rules: [] }],
        transitions: [],
      };
    }
    return null;
  },
  upsertWorkflow: () => {},
  deleteWorkflow: () => false,
  workflowExists: () => false,
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => '[]'),
  exec: vi.fn(),
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
  })),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: (_fn: any) => mockExecAsync,
  };
});

import * as sdkSession from '../sdk-session.js';
import * as fleetMonitor from '../fleet-monitor.js';

// Build a mock query that yields a result message with configurable is_error
function createResultQuery(is_error: boolean): Partial<Query> {
  return {
    interrupt: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: 'result',
        session_id: 'test-sdk-session',
        total_cost_usd: 0.001,
        duration_ms: 100,
        is_error,
        subtype: is_error ? 'error' : 'success',
        num_turns: 1,
        result: 'done',
        usage: { input_tokens: 10, output_tokens: 20 },
        modelUsage: {},
      } as any;
    },
  };
}

// Build a mock query that throws mid-iteration (simulates cwd invalidation)
function createThrowingQuery(errorMessage: string): Partial<Query> {
  return {
    interrupt: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      throw new Error(errorMessage);
    },
  };
}

const BASE_CALLBACKS = {
  onText: vi.fn(),
  onToolEvent: vi.fn(),
  onComplete: vi.fn(),
  onError: vi.fn(),
};

describe('stream-query session status regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up all active sessions
    sdkSession.getActiveSessions().forEach((sid) => sdkSession.disconnectSession(sid));
    // Clear fleet monitor sessions
    fleetMonitor._clearSessions();
  });

  describe('Bug Fix 1: captain notification failure must not override completed status', () => {
    it('keeps status "completed" when notifySessionComplete throws', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {
        throw new Error('Socket closed — captain unavailable');
      });
      mockQuery.mockReturnValue(createResultQuery(false));

      const sessionId = 'captain-throw-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'Hello', '/tmp/workspace', callbacks);

      // Wait for the async query to complete
      await new Promise((r) => setTimeout(r, 200));

      const detail = fleetMonitor.getSessionDetail(sessionId);
      expect(detail?.status).toBe('completed');
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('still calls notifySessionComplete even when it throws (fire-and-forget)', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {
        throw new Error('Captain not available');
      });
      mockQuery.mockReturnValue(createResultQuery(false));

      const sessionId = 'captain-called-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'Hello', '/tmp/workspace', callbacks);
      await new Promise((r) => setTimeout(r, 200));

      // Captain was called, but the throw did not propagate as an error callback
      expect(mockCaptain.notifySessionComplete).toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });
  });

  describe('Bug Fix 2: is_error in completion data drives session status', () => {
    it('marks session "failed" when is_error is true', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {});
      mockQuery.mockReturnValue(createResultQuery(true));

      const sessionId = 'is-error-true-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'Hello', '/tmp/workspace', callbacks);
      await new Promise((r) => setTimeout(r, 200));

      const detail = fleetMonitor.getSessionDetail(sessionId);
      expect(detail?.status).toBe('failed');
    });

    it('marks session "completed" when is_error is false (normal success)', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {});
      mockQuery.mockReturnValue(createResultQuery(false));

      const sessionId = 'is-error-false-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'Hello', '/tmp/workspace', callbacks);
      await new Promise((r) => setTimeout(r, 200));

      const detail = fleetMonitor.getSessionDetail(sessionId);
      expect(detail?.status).toBe('completed');
    });

    it('does NOT call notifySessionComplete when is_error is true', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {});
      mockQuery.mockReturnValue(createResultQuery(true));

      const sessionId = 'no-notify-on-error-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'Hello', '/tmp/workspace', callbacks);
      await new Promise((r) => setTimeout(r, 200));

      // Captain should NOT be notified for error completions
      expect(mockCaptain.notifySessionComplete).not.toHaveBeenCalled();
    });
  });

  describe('Bug Fix 3: merge-cleanup cwd invalidation must not cause false "failed" status', () => {
    /**
     * Root cause: merge-cleanup agent previously removed the worktree BEFORE reporting success.
     * The removed worktree invalidated the cwd, so any subsequent Bash call threw
     * "Working directory no longer exists". That exception propagated as is_error: true
     * through the SDK result message, landing in the catch block of stream-query.ts
     * which set status = 'failed' even though the cherry-pick had succeeded.
     *
     * Fix: "Report success" step moved BEFORE worktree removal so the final Bash call
     * (cd <main_repo_root> && git worktree remove ...) uses an absolute path that
     * is always valid, preventing the exception.
     *
     * These tests verify the two sides of that contract:
     * 1. When the SDK iterator throws (cwd gone mid-session), status ends up 'failed'.
     * 2. When the SDK iterator completes cleanly (cwd valid for last command), status ends up 'completed'.
     *
     * The fix prevents scenario 1 from occurring in merge-cleanup by reordering the steps.
     */
    it('marks session "failed" when the SDK iterator throws (cwd-invalidation scenario)', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {});
      mockQuery.mockReturnValue(
        createThrowingQuery('Working directory no longer exists')
      );

      const sessionId = 'cwd-invalidation-throws-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'merge cleanup', '/tmp/workspace', callbacks);
      await new Promise((r) => setTimeout(r, 200));

      const detail = fleetMonitor.getSessionDetail(sessionId);
      expect(detail?.status).toBe('failed');
      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.onError.mock.calls[0][0]).toContain('Working directory no longer exists');
    });

    it('marks session "completed" when the SDK iterator finishes without throwing (clean last command)', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {});
      // Simulates the fixed ordering: last Bash call uses absolute path, succeeds, no exception
      mockQuery.mockReturnValue(createResultQuery(false));

      const sessionId = 'clean-last-command-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'merge cleanup', '/tmp/workspace', callbacks);
      await new Promise((r) => setTimeout(r, 200));

      const detail = fleetMonitor.getSessionDetail(sessionId);
      expect(detail?.status).toBe('completed');
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('calls onError with the cwd error message so the orchestrator can diagnose the failure', async () => {
      mockCaptain.notifySessionComplete.mockImplementation(() => {});
      mockQuery.mockReturnValue(
        createThrowingQuery('Working directory no longer exists: /path/to/worktree')
      );

      const sessionId = 'cwd-error-message-test';
      const callbacks = { ...BASE_CALLBACKS, onText: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

      sdkSession.submitQuery(sessionId, 'merge cleanup', '/path/to/worktree', callbacks);
      await new Promise((r) => setTimeout(r, 200));

      expect(callbacks.onError).toHaveBeenCalledTimes(1);
      const errorMsg: string = callbacks.onError.mock.calls[0][0];
      expect(errorMsg).toContain('Working directory no longer exists');
    });
  });
});
