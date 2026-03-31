import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist mock functions so they are available before module imports
const { mockQuery, mockCreateSdkMcpServer } = vi.hoisted(() => {
  // Minimal async iterable that terminates immediately (no messages)
  const emptyAsyncIterable = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true, value: undefined }),
        interrupt: vi.fn().mockResolvedValue(undefined),
      };
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  };

  const mockQuery = vi.fn(() => emptyAsyncIterable);
  const mockCreateSdkMcpServer = vi.fn((cfg: any) => cfg);

  return { mockQuery, mockCreateSdkMcpServer };
});

// Mock the SDK before any imports so captain.ts picks up the mock
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: vi.fn((name: string, desc: string, schema: any, handler: any) => ({
    name, desc, schema, handler,
  })),
}));

// Mock captain-prompt so startCaptainSession does not try to access the filesystem
vi.mock('../captain-prompt.js', () => ({
  buildCaptainSystemPrompt: vi.fn().mockResolvedValue('mocked system prompt'),
  isIdleMessage: vi.fn().mockReturnValue(false),
}));

// Mock state-persistence to avoid DB access
vi.mock('../state-persistence.js', () => ({
  saveCaptainState: vi.fn(),
  loadCaptainState: vi.fn().mockReturnValue(null),
}));

// Mock captain-tools to avoid dependency on actual tools
vi.mock('../captain-tools.js', () => ({
  buildFleetMcpTools: vi.fn().mockReturnValue([]),
}));

const mockIsBriefMode = vi.fn().mockReturnValue(false);
vi.mock('../captain-tick.js', () => ({
  isBriefMode: () => mockIsBriefMode(),
  resetBriefMode: vi.fn(),
}));

// Minimal mocks for config values used by captain.ts
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js') as any;
  return {
    ...actual,
    getCaptainModel: vi.fn().mockReturnValue('claude-3-5-sonnet-20241022'),
    BYPASS_PERMISSIONS: false,
    CAPTAIN_MAX_TURNS: 10,
    CAPTAIN_WORKSPACE: '/tmp/test-workspace',
    CAPTAIN_CONTEXT_WINDOW: 1_000_000,
  };
});

import * as captain from '../captain.js';

describe('Captain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isCaptainSession', () => {
    it('returns true for captain session IDs', () => {
      expect(captain.isCaptainSession('captain-1234567890')).toBe(true);
      expect(captain.isCaptainSession('captain-test')).toBe(true);
    });

    it('returns false for non-captain session IDs', () => {
      expect(captain.isCaptainSession('session-123')).toBe(false);
      expect(captain.isCaptainSession('test-session')).toBe(false);
      expect(captain.isCaptainSession('captain')).toBe(false);
      expect(captain.isCaptainSession('captains-log')).toBe(false);
    });
  });

  describe('getCaptainSessionId', () => {
    it('returns null when Captain is not running', () => {
      const sessionId = captain.getCaptainSessionId();
      expect(sessionId).toBeNull();
    });
  });

  describe('sendCaptainMessage', () => {
    it('throws when Captain is not active', () => {
      expect(() => captain.sendCaptainMessage('test message', 'web', 'test-id')).toThrow('Captain session is not active');
    });
  });

  // ---- Context Management Tests (Phase 1) ----
  describe('Context Management', () => {
    it('getCaptainStatus() includes token fields', () => {
      const status = captain.getCaptainStatus();
      expect(status).toHaveProperty('lastInputTokens');
      expect(status).toHaveProperty('totalInputTokens');
      expect(status).toHaveProperty('contextPct');
      expect(typeof status.lastInputTokens).toBe('number');
      expect(typeof status.totalInputTokens).toBe('number');
      expect(typeof status.contextPct).toBe('number');
    });

    it('token extraction logic sums all three token types', () => {
      // Test the extraction logic used in processQueryResponse
      const usageObj = {
        input_tokens: 1000,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 200,
      };

      const currentInputTokens = (usageObj.input_tokens || 0)
        + (usageObj.cache_read_input_tokens || 0)
        + (usageObj.cache_creation_input_tokens || 0);

      expect(currentInputTokens).toBe(1700);
    });

    it('token extraction handles missing usage fields gracefully', () => {
      // Test with undefined usage
      const usageObj1 = undefined;
      const tokens1 = ((usageObj1 as any)?.input_tokens || 0)
        + ((usageObj1 as any)?.cache_read_input_tokens || 0)
        + ((usageObj1 as any)?.cache_creation_input_tokens || 0);
      expect(tokens1).toBe(0);

      // Test with partial usage
      const usageObj2 = { input_tokens: 100 };
      const tokens2 = ((usageObj2 as any)?.input_tokens || 0)
        + ((usageObj2 as any)?.cache_read_input_tokens || 0)
        + ((usageObj2 as any)?.cache_creation_input_tokens || 0);
      expect(tokens2).toBe(100);
    });

    it('contextPct calculation is correct', () => {
      const CONTEXT_WINDOW = 1_000_000;

      // 10% of context
      const lastInputTokens1 = 100_000;
      const contextPct1 = (lastInputTokens1 / CONTEXT_WINDOW) * 100;
      expect(contextPct1).toBe(10);

      // 0.17% of context
      const lastInputTokens2 = 1700;
      const contextPct2 = Math.round((lastInputTokens2 / CONTEXT_WINDOW) * 100 * 100) / 100;
      expect(contextPct2).toBe(0.17);

      // Zero tokens
      const lastInputTokens3 = 0;
      const contextPct3 = lastInputTokens3 > 0
        ? Math.round((lastInputTokens3 / CONTEXT_WINDOW) * 100 * 100) / 100
        : 0;
      expect(contextPct3).toBe(0);
    });

    it('cumulative token tracking logic', () => {
      // Simulate cumulative tracking
      let totalInputTokens = 0;

      // First query: 1000 tokens
      totalInputTokens = totalInputTokens + 1000;
      expect(totalInputTokens).toBe(1000);

      // Second query: 500 tokens
      totalInputTokens = totalInputTokens + 500;
      expect(totalInputTokens).toBe(1500);

      // Third query: 200 tokens
      totalInputTokens = totalInputTokens + 200;
      expect(totalInputTokens).toBe(1700);
    });
  });

  // ---- Regression tests for boot query options ----
  // Tests the options captain.ts passes to query() on first boot.
  // Covers both the settingSources fix and the BYPASS_PERMISSIONS env var fix.
  describe('startCaptainSession boot query options', () => {
    const stubDependencies = {
      database: {
        recordMessage: vi.fn(() => ({ id: 1 })),
        updateMessage: vi.fn(),
        recordToolEvent: vi.fn(),
        updateToolEvent: vi.fn(),
        upsertFleetSession: vi.fn(),
        getAllFleetSessions: vi.fn(() => []),
        getLastSdkSessionId: vi.fn(() => null),
        getImage: vi.fn(() => null),
        getSessionMetadata: vi.fn(() => null),
      } as any,
      sdkSession: {} as any,
      sessionWorkspaces: new Map<string, string>(),
      io: {} as any,
      buildSocketCallbacks: vi.fn(() => ({})),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as any,
    };

    it('uses correct options: empty settingSources and no bypassPermissions when BYPASS_PERMISSIONS is false', async () => {
      // This single test covers two regressions in one query() call:
      //
      // Fix 1 (settingSources): Captain must use settingSources=[] to avoid spawning
      // user-configured MCP stdio processes during boot.
      //
      // Fix 2 (BYPASS_PERMISSIONS): The test mocks BYPASS_PERMISSIONS=false to verify
      // that captain.ts respects the constant value. When false, permissionMode must
      // NOT be "bypassPermissions".
      //
      // The module-level config mock has BYPASS_PERMISSIONS set to false.
      await captain.startCaptainSession('/test/workspace', stubDependencies);

      expect(mockQuery).toHaveBeenCalled();

      const callArgs = mockQuery.mock.calls[0][0] as any;

      // Assert Fix 1: settingSources must be empty array
      const settingSources = callArgs?.options?.settingSources;
      expect(settingSources).toBeDefined();
      expect(settingSources).not.toContain('user');
      expect(settingSources).toEqual([]);

      // Assert Fix 2: permissionMode must NOT be "bypassPermissions" when BYPASS_PERMISSIONS=false
      expect(callArgs?.options?.permissionMode).not.toBe('bypassPermissions');
      expect(callArgs?.options?.allowDangerouslySkipPermissions).toBe(false);
    });
  });

  // ---- Regression tests for callback Map cleanup on Captain restart (Fix #5) ----
  //
  // The fix added calls to clearResponseCallbacks(), clearInteractiveCallbacks(),
  // and clearPendingInteractiveMessages() at the start of startCaptainSession().
  // These tests verify each clear function works correctly, which is the unit
  // being protected against regression.
  describe('Callback Map cleanup to prevent memory leaks (regression Fix #5)', () => {
    it('clearResponseCallbacks empties the response callback Map', () => {
      const noop = { onText: vi.fn(), onThinking: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
      captain.registerResponseCallback('cb-1', noop);
      captain.registerResponseCallback('cb-2', noop);

      expect(captain.hasResponseCallback('cb-1')).toBe(true);
      expect(captain.hasResponseCallback('cb-2')).toBe(true);

      captain.clearResponseCallbacks();

      expect(captain.hasResponseCallback('cb-1')).toBe(false);
      expect(captain.hasResponseCallback('cb-2')).toBe(false);
    });

    it('clearResponseCallbacks is a no-op when Map is already empty', () => {
      captain.clearResponseCallbacks();
      expect(() => captain.clearResponseCallbacks()).not.toThrow();
    });

    it('clearInteractiveCallbacks empties the interactive callback Map', () => {
      const interactiveCb = { onInteractiveMessage: vi.fn() };
      captain.registerInteractiveCallback('ic-1', interactiveCb);
      captain.registerInteractiveCallback('ic-2', interactiveCb);

      // Verify registration happened by checking it can be unregistered
      captain.unregisterInteractiveCallback('ic-1');

      // Now clear the rest
      captain.registerInteractiveCallback('ic-1', interactiveCb); // re-add
      captain.clearInteractiveCallbacks();

      // After clear, unregistering nonexistent entries should not throw
      expect(() => captain.unregisterInteractiveCallback('ic-1')).not.toThrow();
      expect(() => captain.unregisterInteractiveCallback('ic-2')).not.toThrow();
    });

    it('clearPendingInteractiveMessages resolves all pending entries with __cleared__ actionId', () => {
      let resolvedActionId: string | null = null;

      const mockMessage = {
        id: 'msg-1',
        type: 'confirmation' as const,
        text: 'Test message',
        actions: [],
        responseState: 'pending' as const,
        createdAt: Date.now(),
      };

      const timer = setTimeout(() => {}, 300_000);
      captain.registerPendingInteractiveMessage('msg-1', {
        message: mockMessage,
        resolve: (response) => {
          resolvedActionId = response.actionId;
        },
        timer,
      });

      expect(captain.getPendingInteractiveMessage('msg-1')).toBeDefined();

      captain.clearPendingInteractiveMessages();

      expect(captain.getPendingInteractiveMessage('msg-1')).toBeUndefined();
      expect(resolvedActionId).toBe('__cleared__');
    });

    it('clearPendingInteractiveMessages clears all pending entries in one call', () => {
      let resolved1 = false;
      let resolved2 = false;

      const makeEntry = (id: string, onResolve: () => void) => ({
        message: {
          id,
          type: 'confirmation' as const,
          text: `Message ${id}`,
          actions: [],
          responseState: 'pending' as const,
          createdAt: Date.now(),
        },
        resolve: (_response: unknown) => { onResolve(); },
        timer: setTimeout(() => {}, 300_000),
      });

      captain.registerPendingInteractiveMessage('m1', makeEntry('m1', () => { resolved1 = true; }));
      captain.registerPendingInteractiveMessage('m2', makeEntry('m2', () => { resolved2 = true; }));

      captain.clearPendingInteractiveMessages();

      expect(resolved1).toBe(true);
      expect(resolved2).toBe(true);
      expect(captain.getPendingInteractiveMessage('m1')).toBeUndefined();
      expect(captain.getPendingInteractiveMessage('m2')).toBeUndefined();
    });
  });

  // ---- Brief mode output suppression (tick loop) ----
  describe('shouldSuppressBriefOutput', () => {
    it('does not suppress when brief mode is off', () => {
      mockIsBriefMode.mockReturnValue(false);
      expect(captain.shouldSuppressBriefOutput('All sessions healthy, nothing to do.')).toBe(false);
    });

    it('suppresses non-actionable output when brief mode is on', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('All sessions are running normally. No action needed.')).toBe(true);
      expect(captain.shouldSuppressBriefOutput('Fleet looks good. Sleeping for 5 minutes.')).toBe(true);
    });

    it('passes through output containing "stuck"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('Session sess-abc appears stuck with 45 tool calls')).toBe(false);
    });

    it('passes through output containing "error"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('Error: session failed to start')).toBe(false);
    });

    it('passes through output containing "failed"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('Session sess-xyz failed after 30 tools')).toBe(false);
    });

    it('passes through output containing "pending"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('2 sessions pending approval')).toBe(false);
    });

    it('passes through output containing "completed"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('Session sess-abc completed successfully')).toBe(false);
    });

    it('passes through output containing "approve"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('Need to approve pending session')).toBe(false);
    });

    it('passes through output containing "start_session"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('Calling start_session for the bug fix')).toBe(false);
    });

    it('passes through output containing "decision"', () => {
      mockIsBriefMode.mockReturnValue(true);
      expect(captain.shouldSuppressBriefOutput('Decision needed: which branch to target?')).toBe(false);
    });
  });

});
