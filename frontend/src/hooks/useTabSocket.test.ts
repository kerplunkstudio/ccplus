// Import from /pure to disable automatic cleanup
import { renderHook, waitFor, cleanup } from '@testing-library/react/pure';
import { act } from 'react';
import { useTabSocket } from './useTabSocket';
import { io } from 'socket.io-client';

jest.mock('socket.io-client');

// Manual cleanup that swallows AggregateError from async operations
afterEach(() => {
  try {
    cleanup();
  } catch (error) {
    // Swallow AggregateError from async operations completing after unmount - this is expected
    if (!(error && typeof error === 'object' && 'name' in error && error.name === 'AggregateError')) {
      throw error;
    }
  }
});

describe('useTabSocket session restore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fetch to resolve immediately
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('/api/history/')) {
            return { messages: [], streaming: false };
          }
          if (url.includes('/api/activity/')) {
            return { events: [] };
          }
          return {};
        },
      }) as Promise<Response>;
    });
  });

  it('should restore session from database', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Override default fetch mock for this test to return messages
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('/api/history/')) {
            return {
              messages: [
                { id: 1, content: 'Test message', role: 'user', timestamp: new Date().toISOString() }
              ],
              streaming: false
            };
          }
          if (url.includes('/api/activity/')) {
            return { events: [] };
          }
          return {};
        },
      });
    });

    const { result } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for restore to complete
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    }, { timeout: 3000 });

    // Verify message was restored from database
    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].content).toBe('Test message');
  });

  it('should handle empty sessions', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    const { result } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    }, { timeout: 3000 });

    // Verify no messages
    expect(result.current.messages.length).toBe(0);
    expect(result.current.streaming).toBe(false);
  });
});

describe('useTabSocket persistent socket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fetch to resolve immediately
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('/api/history/')) {
            return { messages: [], streaming: false };
          }
          if (url.includes('/api/activity/')) {
            return { events: [] };
          }
          return {};
        },
      }) as Promise<Response>;
    });
  });

  it('should create socket only once regardless of session changes', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render with session-a
    const { result, rerender } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify io() was called once
    expect(io).toHaveBeenCalledTimes(1);

    // Rerender with session-b
    await act(async () => {
      rerender({ sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Rerender with session-c
    await act(async () => {
      rerender({ sessionId: 'session-c' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify io() was still called only ONCE (socket persists across sessions)
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('should not include auth in socket options', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render with sessionId
    const { result } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify io() was called without auth
    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      {
        transports: ['polling', 'websocket'],
      }
    );

    // Verify auth is NOT in options
    const options = (io as jest.Mock).mock.calls[0][1];
    expect(options).not.toHaveProperty('auth');
  });

  it('should emit join_session on connect', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render
    const { result } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Find and trigger connect handler
    const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];

    await act(async () => {
      connectHandler?.();
    });

    // Verify join_session was emitted
    expect(mockSocket.emit).toHaveBeenCalledWith('join_session', { session_id: 'session-a' });
  });

  it('should emit leave_session and join_session on session switch', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render with session-a
    const { result, rerender } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate connect
    const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
    await act(async () => {
      connectHandler?.();
    });

    // Clear previous emit calls
    mockSocket.emit.mockClear();

    // Rerender with session-b
    await act(async () => {
      rerender({ sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify leave_session was called for session-a
    expect(mockSocket.emit).toHaveBeenCalledWith('leave_session', { session_id: 'session-a' });

    // Verify join_session was called for session-b (now includes last_seq)
    expect(mockSocket.emit).toHaveBeenCalledWith('join_session', { session_id: 'session-b', last_seq: 0 });
  });

  it('should include session_id in message emit', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render
    const { result } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate connect
    const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
    await act(async () => {
      connectHandler?.();
    });

    // Call sendMessage
    await act(async () => {
      result.current.sendMessage('Hello');
    });

    // Verify message emit includes session_id
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'message',
      expect.objectContaining({ session_id: 'session-a' })
    );
  });

  it('should include session_id in cancel emit', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render
    const { result } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate connect
    const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
    await act(async () => {
      connectHandler?.();
    });

    // Call cancelQuery
    await act(async () => {
      result.current.cancelQuery();
    });

    // Verify cancel emit includes session_id
    expect(mockSocket.emit).toHaveBeenCalledWith('cancel', { session_id: 'session-a' });
  });

  it('should not close socket on session switch', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render with session-a
    const { result, rerender } = renderHook(
      ({ sessionId }) => useTabSocket(sessionId),
      {
        initialProps: { sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Rerender with session-b
    await act(async () => {
      rerender({ sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify close() was NOT called
    expect(mockSocket.close).not.toHaveBeenCalled();
  });
});
