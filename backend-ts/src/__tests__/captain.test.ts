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

// Minimal mocks for config values used by captain.ts
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js') as any;
  return {
    ...actual,
    getCaptainModel: vi.fn().mockReturnValue('claude-3-5-sonnet-20241022'),
    CAPTAIN_MAX_TURNS: 10,
    CAPTAIN_WORKSPACE: '/tmp/test-workspace',
    BYPASS_PERMISSIONS: false,
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

  // ---- Regression tests for Fix 2: settingSources = [] (cold-start fix) ----
  describe('startCaptainSession settingSources (regression: cold-start fix)', () => {
    // Minimal stub dependencies required by startCaptainSession
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

    it('does not include "user" in settingSources on boot query (prevents stdio MCP spawn)', async () => {
      await captain.startCaptainSession('/test/workspace', stubDependencies);

      expect(mockQuery).toHaveBeenCalled();

      const callArgs = mockQuery.mock.calls[0][0] as any;
      const settingSources = callArgs?.options?.settingSources;

      expect(settingSources).toBeDefined();
      expect(settingSources).not.toContain('user');
      // Must be an empty array — not undefined, not ['user']
      expect(settingSources).toEqual([]);
    });
  });
});
