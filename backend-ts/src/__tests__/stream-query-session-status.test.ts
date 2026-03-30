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
});
