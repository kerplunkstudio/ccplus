import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock dependencies before importing
const mockSpawn = vi.fn();
const mockGetUserMcpServers = vi.fn();
const mockExistsSync = vi.fn();
const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('../mcp-config.js', () => ({
  getUserMcpServers: mockGetUserMcpServers,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

vi.mock('../logger.js', () => ({
  log: mockLog,
}));

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    MEMORY_SEARCH_TIMEOUT_MS: 1000,
  };
});

// Import after mocks are set up
const {
  searchMemories,
  storeMemory,
  isMemoryAvailable,
  shutdownMemoryClient,
} = await import('../memory-client.js');

// Mock child process that extends EventEmitter
class MockChildProcess extends EventEmitter {
  stdin = {
    write: vi.fn((data: string, callback?: (error?: Error) => void) => {
      if (callback) callback();
      return true;
    }),
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}

describe('memory-client', () => {
  let currentMockProcess: MockChildProcess;

  beforeEach(() => {
    // CRITICAL: Reset module state FIRST, which sets memoryConfig = null
    shutdownMemoryClient();

    // Clear all mocks
    vi.clearAllMocks();

    // Re-establish mocks that loadMemoryConfig() will call when memoryConfig is null
    mockGetUserMcpServers.mockReturnValue([
      {
        name: 'memory',
        config: {
          type: 'stdio',
          command: '/usr/local/bin/memory',
          args: [],
        },
      },
    ]);
    mockExistsSync.mockReturnValue(true);

    // Fresh process for each test
    mockSpawn.mockImplementation(() => {
      currentMockProcess = new MockChildProcess();
      return currentMockProcess;
    });
  });

  afterEach(() => {
    shutdownMemoryClient();

    if (vi.isFakeTimers()) {
      vi.useRealTimers();
    }
  });

  /**
   * Helper function to get the last request ID from mock stdin writes.
   */
  function getLastRequestId(proc: MockChildProcess): number {
    const calls = proc.stdin.write.mock.calls;
    if (calls.length === 0) return 0;
    const lastCall = calls[calls.length - 1][0] as string;
    try {
      const parsed = JSON.parse(lastCall.trim());
      return parsed.id;
    } catch {
      return 0;
    }
  }

  /**
   * Helper function to initialize the process and return the spawned MockChildProcess.
   * This triggers a call that spawns the process, sends init response, and completes.
   */
  async function initializeProcess(): Promise<MockChildProcess> {
    // Trigger a search to spawn the process
    const promise = searchMemories('init');
    await new Promise((r) => setImmediate(r));

    const proc = currentMockProcess;

    // Send init response using dynamic ID
    const initId = getLastRequestId(proc);
    proc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initId,
          result: { protocolVersion: '2024-11-05' },
        }) + '\n'
      )
    );

    await new Promise((r) => setImmediate(r));

    // Send search response to complete the init call using dynamic ID
    const opId = getLastRequestId(proc);
    proc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: opId,
          result: { content: [{ type: 'text', text: '[]' }] },
        }) + '\n'
      )
    );

    await promise;
    return proc;
  }

  describe('isMemoryAvailable', () => {
    it('returns true when config has memory server', () => {
      const result = isMemoryAvailable();
      expect(result).toBe(true);
      expect(mockGetUserMcpServers).toHaveBeenCalled();
      expect(mockExistsSync).toHaveBeenCalledWith('/usr/local/bin/memory');
    });

    it('returns false when no memory server configured', () => {
      shutdownMemoryClient(); // Reset memoryConfig to null
      mockGetUserMcpServers.mockReturnValue([]); // No servers

      const result = isMemoryAvailable();
      expect(result).toBe(false);
    });

    it('returns false when memory server is not stdio type', () => {
      shutdownMemoryClient();
      mockGetUserMcpServers.mockReturnValue([
        {
          name: 'memory',
          config: {
            type: 'http',
            url: 'http://localhost:3000',
          },
        },
      ]);

      const result = isMemoryAvailable();
      expect(result).toBe(false);
    });

    it('returns false when memory server binary does not exist', () => {
      shutdownMemoryClient();
      mockExistsSync.mockReturnValue(false);

      const result = isMemoryAvailable();
      expect(result).toBe(false);
    });
  });

  describe('searchMemories', () => {
    it('returns raw text from MCP response', async () => {
      const responseText = 'Found 1 memories:\n\n1. Test memory 1 (score: 0.95)\n   Tags: tag1, tag2\n   Created: 2024-01-01T00:00:00Z';

      const searchPromise = searchMemories('test query', 5);
      await new Promise((r) => setImmediate(r));

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await new Promise((r) => setImmediate(r));

      // Search response using dynamic ID
      const opId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: opId,
            result: {
              content: [
                {
                  type: 'text',
                  text: responseText,
                },
              ],
              isError: false,
            },
          }) + '\n'
        )
      );

      const result = await searchPromise;

      expect(result).toBe(responseText);
    });

    it('returns empty string on timeout', async () => {
      vi.useFakeTimers();

      const searchPromise = searchMemories('test query');
      await vi.advanceTimersByTimeAsync(0);

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await vi.advanceTimersByTimeAsync(0);

      // Advance past timeout (1000ms + buffer)
      await vi.advanceTimersByTimeAsync(1100);

      const result = await searchPromise;
      expect(result).toBe('');
    });

    it('returns empty string when not configured', async () => {
      shutdownMemoryClient();
      mockGetUserMcpServers.mockReturnValue([]); // No memory server

      const result = await searchMemories('test query');
      expect(result).toBe('');
    });

    it('returns text as-is even if not JSON', async () => {
      const searchPromise = searchMemories('test query');
      await new Promise((r) => setImmediate(r));

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await new Promise((r) => setImmediate(r));

      // Plain text response (not JSON) using dynamic ID
      const opId = getLastRequestId(proc);
      const plainText = 'No memories found for this query.';
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: opId,
            result: {
              content: [{ type: 'text', text: plainText }],
            },
          }) + '\n'
        )
      );

      const result = await searchPromise;
      expect(result).toBe(plainText);
    });
  });

  describe('storeMemory', () => {
    it('sends correct MCP message format and returns result', async () => {
      const storePromise = storeMemory('Test content', 'tag1,tag2', {
        source: 'test',
      });

      await new Promise((r) => setImmediate(r));

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await new Promise((r) => setImmediate(r));

      // Store response using dynamic ID
      const opId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: opId,
            result: {
              content: [{ type: 'text', text: 'Memory stored successfully' }],
              isError: false,
            },
          }) + '\n'
        )
      );

      const result = await storePromise;
      expect(result).toBe('Memory stored successfully');

      // Verify message format
      const calls = proc.stdin.write.mock.calls.map((c: any) => c[0]);
      const storeCall = calls.find((c: string) => c.includes('"name":"memory_store"'));
      expect(storeCall).toBeDefined();

      const storeRequest = JSON.parse(storeCall!.trim());
      expect(storeRequest.params.arguments).toEqual({
        content: 'Test content',
        metadata: {
          tags: 'tag1,tag2',
          source: 'test',
        },
      });
    });

    it('returns null on MCP error', async () => {
      const storePromise = storeMemory('Test content', 'tag1');
      await new Promise((r) => setImmediate(r));

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await new Promise((r) => setImmediate(r));

      // Store error using dynamic ID
      const opId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: opId,
            error: { code: -32001, message: 'Store failed' },
          }) + '\n'
        )
      );

      const result = await storePromise;
      expect(result).toBeNull();
      expect(mockLog.error).toHaveBeenCalledWith('Memory store failed', expect.any(Object));
    });

    it('returns null when not configured', async () => {
      shutdownMemoryClient();
      mockGetUserMcpServers.mockReturnValue([]); // No memory server

      const result = await storeMemory('Test content', 'tag1');
      expect(result).toBeNull();
    });
  });

  describe('shutdownMemoryClient', () => {
    it('kills process', async () => {
      await initializeProcess();
      const proc = currentMockProcess;

      shutdownMemoryClient();

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('handles multiple shutdowns gracefully', () => {
      shutdownMemoryClient();
      shutdownMemoryClient();
      expect(true).toBe(true); // No error thrown
    });

    it('clears pending requests on shutdown', async () => {
      const searchPromise = searchMemories('test query');
      await new Promise((r) => setImmediate(r));

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await new Promise((r) => setImmediate(r));

      // Shutdown before search completes
      shutdownMemoryClient();

      // searchMemories catches all errors and returns ''
      const result = await searchPromise;
      expect(result).toBe('');
    });
  });

  describe('process error handling', () => {
    it('returns empty string on process crash', async () => {
      const searchPromise = searchMemories('test query');
      await new Promise((r) => setImmediate(r));

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await new Promise((r) => setImmediate(r));

      // Process crashes
      proc.emit('error', new Error('Process crashed'));

      // searchMemories catches all errors and returns ''
      const result = await searchPromise;
      expect(result).toBe('');

      expect(mockLog.error).toHaveBeenCalledWith(
        'Memory server process error',
        expect.any(Object)
      );
    });

    it('returns empty string on process exit', async () => {
      const searchPromise = searchMemories('test query');
      await new Promise((r) => setImmediate(r));

      const proc = currentMockProcess;

      // Initialize using dynamic ID
      const initId = getLastRequestId(proc);
      proc.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: initId,
            result: { protocolVersion: '2024-11-05' },
          }) + '\n'
        )
      );

      await new Promise((r) => setImmediate(r));

      // Process exits
      proc.emit('exit', 1, null);

      // searchMemories catches all errors and returns ''
      const result = await searchPromise;
      expect(result).toBe('');

      expect(mockLog.info).toHaveBeenCalledWith('Memory server process exited', {
        code: 1,
        signal: null,
      });
    });
  });
});
