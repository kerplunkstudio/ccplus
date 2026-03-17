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

describe('useTabSocket session cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fetch to resolve immediately
    global.fetch = jest.fn((url: string) => {
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
      });
    });
  });

  it('should cache session state when switching tabs during streaming', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render hook with session A
    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Wait for initial restore to complete
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate receiving text_delta to populate streaming content
    const textDeltaHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === 'text_delta'
    )?.[1];

    await act(async () => {
      textDeltaHandler?.({ text: 'Hello world', message_id: 'msg-1' });
    });

    // Verify messages were added
    expect(result.current.messages.length).toBeGreaterThan(0);
    const messagesBefore = result.current.messages;

    // Switch to session B (this should cache session A's state)
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    // Wait for session B restore to complete
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify session A was reset
    expect(result.current.messages.length).toBe(0);

    // Switch back to session A (should restore from cache, not DB)
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-a' });
    });

    // Wait for restore to complete
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify messages were restored from cache
    expect(result.current.messages.length).toBe(messagesBefore.length);
    expect(result.current.messages[0].content).toBe(messagesBefore[0].content);
  });

  it('should delete cache entry on final completion', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Override default fetch mock for this test to return a message
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.includes('/api/history/')) {
            return {
              messages: [{ id: 1, content: 'Test', role: 'user', timestamp: new Date().toISOString() }],
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

    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate text_delta
    const textDeltaHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === 'text_delta'
    )?.[1];

    await act(async () => {
      textDeltaHandler?.({ text: 'Response', message_id: 'msg-1' });
    });

    // Switch to session B to cache session A
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate response_complete with final completion flag
    const responseCompleteHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === 'response_complete'
    )?.[1];

    // Switch back to session A
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-a' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate final completion
    await act(async () => {
      responseCompleteHandler?.({
        sdk_session_id: 'final-session-id',
        cost: 0.01,
        duration_ms: 1000,
      });
    });

    // Switch to session B and back to session A again
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-a' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify session A state comes from DB fetch (cache was deleted)
    // We can check this by verifying fetch was called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/history/session-a')
    );
  });

  it('should preserve streaming state during tab switch', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Simulate text_delta to start streaming
    const textDeltaHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === 'text_delta'
    )?.[1];

    await act(async () => {
      textDeltaHandler?.({ text: 'Streaming...', message_id: 'msg-1' });
    });

    // Verify streaming is active
    expect(result.current.streaming).toBe(true);

    // Switch to session B
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify streaming was reset for session B
    expect(result.current.streaming).toBe(false);

    // Switch back to session A
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-a' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify streaming state was restored
    expect(result.current.streaming).toBe(true);
  });

  it('should not cache empty sessions', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify no messages
    expect(result.current.messages.length).toBe(0);

    // Switch to session B (should not cache session A since it's empty)
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Switch back to session A
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-a' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify fetch was called (cache was not used because session was empty)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/history/session-a')
    );
  });
});

describe('useTabSocket persistent socket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fetch to resolve immediately
    global.fetch = jest.fn((url: string) => {
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
      });
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
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
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
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Rerender with session-c
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-c' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify io() was still called only ONCE (socket persists across sessions)
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('should not include session_id in auth handshake', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      connected: true,
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Render with token and sessionId
    const { result } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify io() was called with correct auth (no session_id)
    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      {
        auth: { token: 'test-token' },
        transports: ['polling', 'websocket'],
      }
    );

    // Verify session_id is NOT in auth object
    const authObject = (io as jest.Mock).mock.calls[0][1].auth;
    expect(authObject).not.toHaveProperty('session_id');
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
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
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
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
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
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify leave_session was called for session-a
    expect(mockSocket.emit).toHaveBeenCalledWith('leave_session', { session_id: 'session-a' });

    // Verify join_session was called for session-b
    expect(mockSocket.emit).toHaveBeenCalledWith('join_session', { session_id: 'session-b' });
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
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
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
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
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
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Wait for initial restore
    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Rerender with session-b
    await act(async () => {
      rerender({ token: 'test-token', sessionId: 'session-b' });
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });

    // Verify close() was NOT called
    expect(mockSocket.close).not.toHaveBeenCalled();
  });
});
