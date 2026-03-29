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
