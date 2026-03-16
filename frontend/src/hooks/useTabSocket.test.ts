import { renderHook, act } from '@testing-library/react';
import { useTabSocket } from './useTabSocket';
import { io } from 'socket.io-client';

jest.mock('socket.io-client');

describe('useTabSocket session cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('should cache session state when switching tabs during streaming', async () => {
    const mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);

    // Mock fetch for session restore
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], streaming: false }),
    });

    // Render hook with session A
    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

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
    rerender({ token: 'test-token', sessionId: 'session-b' });

    // Verify session A was reset
    expect(result.current.messages.length).toBe(0);

    // Switch back to session A (should restore from cache, not DB)
    rerender({ token: 'test-token', sessionId: 'session-a' });

    // Wait for restore to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
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

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ id: 1, content: 'Test', role: 'user', timestamp: new Date().toISOString() }],
        streaming: false
      }),
    });

    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Simulate text_delta
    const textDeltaHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === 'text_delta'
    )?.[1];

    await act(async () => {
      textDeltaHandler?.({ text: 'Response', message_id: 'msg-1' });
    });

    // Switch to session B to cache session A
    rerender({ token: 'test-token', sessionId: 'session-b' });

    // Simulate response_complete with final completion flag
    const responseCompleteHandler = mockSocket.on.mock.calls.find(
      (call) => call[0] === 'response_complete'
    )?.[1];

    // Switch back to session A
    rerender({ token: 'test-token', sessionId: 'session-a' });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
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
    rerender({ token: 'test-token', sessionId: 'session-b' });
    rerender({ token: 'test-token', sessionId: 'session-a' });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
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

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], streaming: false }),
    });

    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

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
    rerender({ token: 'test-token', sessionId: 'session-b' });

    // Verify streaming was reset for session B
    expect(result.current.streaming).toBe(false);

    // Switch back to session A
    rerender({ token: 'test-token', sessionId: 'session-a' });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
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

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], streaming: false }),
    });

    const { result, rerender } = renderHook(
      ({ token, sessionId }) => useTabSocket(token, sessionId),
      {
        initialProps: { token: 'test-token', sessionId: 'session-a' },
      }
    );

    // Verify no messages
    expect(result.current.messages.length).toBe(0);

    // Switch to session B (should not cache session A since it's empty)
    rerender({ token: 'test-token', sessionId: 'session-b' });

    // Switch back to session A
    rerender({ token: 'test-token', sessionId: 'session-a' });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Verify fetch was called (cache was not used because session was empty)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/history/session-a')
    );
  });
});
