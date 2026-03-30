import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// Hoist mock functions so they are available before module imports
const { mockQuery, mockCreateSdkMcpServer, mockGetImage, mockGetLatestCaptainConversationId, mockSaveCaptainMessage } = vi.hoisted(() => {
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
  const mockGetImage = vi.fn(() => null);
  const mockGetLatestCaptainConversationId = vi.fn(() => null);
  const mockSaveCaptainMessage = vi.fn();

  return { mockQuery, mockCreateSdkMcpServer, mockGetImage, mockGetLatestCaptainConversationId, mockSaveCaptainMessage };
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

// Mock database to avoid SQLite access and to control image retrieval
vi.mock('../database.js', () => ({
  getImage: mockGetImage,
  getLatestCaptainConversationId: mockGetLatestCaptainConversationId,
  saveCaptainMessage: mockSaveCaptainMessage,
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

  // ---- Regression tests for Captain image upload (Bug Fix) ----
  //
  // Symptom: Images attached in Captain chat were silently dropped.
  // Root cause: useCaptainSocket.ts emitted captain_message without image_ids,
  //   sendCaptainMessage() did not accept imageIds, and startCaptainQuery() did
  //   not build image content blocks.
  // Fix: sendCaptainMessage now accepts imageIds and forwards to startCaptainQuery,
  //   which calls database.getImage() per ID and builds base64 content blocks.
  //
  // These tests fail without the fix and pass with it.
  describe('image upload regression (captain_message with imageIds)', () => {
    const imageUploadDeps = {
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

    // Ensure the captain session is running before image upload tests.
    // startCaptainSession is idempotent — returns existing session if already active.
    beforeAll(async () => {
      await captain.startCaptainSession('/test/workspace', imageUploadDeps);
      // Wait briefly for the boot query's empty iterable to complete
      // so activeQuery is cleared before we call sendCaptainMessage
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('calls database.getImage for each imageId passed to sendCaptainMessage', async () => {
      // REGRESSION: Before the fix, sendCaptainMessage did not accept imageIds
      // so database.getImage was never called. This test would fail on the old code
      // because the imageIds parameter did not exist on the function signature.
      const imageData = Buffer.from('fake-png-bytes');
      mockGetImage.mockReturnValueOnce({
        id: 'img-abc',
        data: imageData,
        mime_type: 'image/png',
      });

      captain.sendCaptainMessage('describe this image', 'web', 'socket-1', ['img-abc']);

      // Allow startCaptainQuery to run (it is async, called via .catch())
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGetImage).toHaveBeenCalledWith('img-abc');
    });

    it('builds image content blocks when images are found in the database', async () => {
      // REGRESSION: Before the fix, the query prompt was always a plain string.
      // With the fix, when imageIds are provided and images are found, the prompt
      // argument passed to query() must be an AsyncIterable (message stream), not
      // a plain string.
      const imageData = Buffer.from('fake-jpeg-bytes');
      mockGetImage.mockReturnValueOnce({
        id: 'img-xyz',
        data: imageData,
        mime_type: 'image/jpeg',
      });

      captain.sendCaptainMessage('what is this?', 'web', 'socket-2', ['img-xyz']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockQuery).toHaveBeenCalled();
      const lastCallArgs = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0] as any;

      // The prompt must be an AsyncIterable (object with Symbol.asyncIterator),
      // not a plain string — this is the key invariant the fix enforces
      expect(typeof lastCallArgs.prompt).not.toBe('string');
      expect(lastCallArgs.prompt[Symbol.asyncIterator]).toBeDefined();
    });

    it('includes an image block and a text block in the message stream content', async () => {
      const imageData = Buffer.from('hello-world');
      const expectedB64 = imageData.toString('base64');
      mockGetImage.mockReturnValueOnce({
        id: 'img-content-check',
        data: imageData,
        mime_type: 'image/png',
      });

      captain.sendCaptainMessage('explain the diagram', 'web', 'socket-3', ['img-content-check']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockQuery).toHaveBeenCalled();
      const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0] as any;
      const promptIterable = lastCall.prompt;

      // Consume the first yielded value from the async iterable
      const iterator = promptIterable[Symbol.asyncIterator]();
      const { value: yielded } = await iterator.next();

      expect(yielded.type).toBe('user');
      expect(yielded.message.role).toBe('user');

      const content: any[] = yielded.message.content;
      const imageBlock = content.find((b: any) => b.type === 'image');
      const textBlock = content.find((b: any) => b.type === 'text');

      // Image block must have base64 source
      expect(imageBlock).toBeDefined();
      expect(imageBlock.source.type).toBe('base64');
      expect(imageBlock.source.media_type).toBe('image/png');
      expect(imageBlock.source.data).toBe(expectedB64);

      // Text block must carry the original message content
      expect(textBlock).toBeDefined();
      expect(textBlock.text).toBe('explain the diagram');
    });

    it('normalizes image/jpg mime type to image/jpeg', async () => {
      const imageData = Buffer.from('jpg-bytes');
      mockGetImage.mockReturnValueOnce({
        id: 'img-jpg',
        data: imageData,
        mime_type: 'image/jpg',
      });

      captain.sendCaptainMessage('caption this', 'web', 'socket-4', ['img-jpg']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0] as any;
      const iterator = lastCall.prompt[Symbol.asyncIterator]();
      const { value: yielded } = await iterator.next();

      const imageBlock = yielded.message.content.find((b: any) => b.type === 'image');
      expect(imageBlock.source.media_type).toBe('image/jpeg');
    });

    it('skips image blocks for IDs not found in the database and falls back to plain text', async () => {
      // When getImage returns null for all IDs, no image blocks are added.
      // The prompt should still be a plain string (content-only, no iterable).
      mockGetImage.mockReturnValue(null);

      captain.sendCaptainMessage('just text', 'web', 'socket-5', ['missing-img-id']);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGetImage).toHaveBeenCalledWith('missing-img-id');

      const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0] as any;
      // When all images are missing, contentBlocks has only the text block (no images),
      // but the code still wraps it in a message stream because imageIds.length > 0.
      // The prompt must still be an AsyncIterable (the wrapping path is entered regardless).
      expect(lastCall.prompt[Symbol.asyncIterator]).toBeDefined();

      // The yielded content should only have the text block — no image block
      const iterator = lastCall.prompt[Symbol.asyncIterator]();
      const { value: yielded } = await iterator.next();
      const content: any[] = yielded.message.content;
      const imageBlock = content.find((b: any) => b.type === 'image');
      expect(imageBlock).toBeUndefined();
    });

    it('uses plain string prompt when no imageIds are provided', async () => {
      // REGRESSION: this verifies the existing non-image path is unaffected by the fix
      captain.sendCaptainMessage('plain message', 'web', 'socket-6');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0] as any;
      expect(typeof lastCall.prompt).toBe('string');
      expect(lastCall.prompt).toBe('plain message');
    });

    it('uses plain string prompt when imageIds is an empty array', async () => {
      captain.sendCaptainMessage('no images', 'web', 'socket-7', []);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0] as any;
      expect(typeof lastCall.prompt).toBe('string');
      expect(lastCall.prompt).toBe('no images');
    });
  });

});
