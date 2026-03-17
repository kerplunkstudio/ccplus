// Import from /pure to disable automatic cleanup
import { renderHook, waitFor, cleanup, act } from '@testing-library/react/pure';
import { useStreamingMessages, fetchUserStats } from './useStreamingMessages';
import { io, Socket } from 'socket.io-client';
import { MutableRefObject } from 'react';
import { ToolEvent, ActivityNode } from '../types';

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

describe('fetchUserStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch and parse user stats successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        total_cost: 1.23,
        total_input_tokens: 1000,
        total_output_tokens: 500,
        total_duration_ms: 5000,
        total_queries: 10,
        total_lines_of_code: 250,
        total_sessions: 3,
      }),
    });

    const stats = await fetchUserStats();

    expect(stats).toEqual({
      totalCost: 1.23,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalDuration: 5000,
      queryCount: 10,
      contextWindowSize: 500_000,
      model: '',
      linesOfCode: 250,
      totalSessions: 3,
    });
  });

  it('should return default values on fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
    });

    const stats = await fetchUserStats();

    expect(stats).toEqual({
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDuration: 0,
      queryCount: 0,
      contextWindowSize: 500_000,
      model: '',
      linesOfCode: 0,
      totalSessions: 0,
    });
  });

  it('should return default values on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const stats = await fetchUserStats();

    expect(stats).toEqual({
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDuration: 0,
      queryCount: 0,
      contextWindowSize: 500_000,
      model: '',
      linesOfCode: 0,
      totalSessions: 0,
    });
  });
});

describe('useStreamingMessages', () => {
  const createMockSocket = () => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    close: jest.fn(),
    io: { on: jest.fn() },
  }) as unknown as Socket;

  const createMockRefs = () => ({
    toolLogRef: { current: [] as ToolEvent[] } as MutableRefObject<ToolEvent[]>,
    activityTreeRef: { current: [] as ActivityNode[] } as MutableRefObject<ActivityNode[]>,
    hasRunningAgents: jest.fn().mockReturnValue(false),
    isRestoringSessionRef: { current: false } as MutableRefObject<boolean>,
    currentSessionIdRef: { current: 'test-session' } as MutableRefObject<string>,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        total_cost: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_duration_ms: 0,
        total_queries: 0,
        total_lines_of_code: 0,
        total_sessions: 0,
      }),
    });
  });

  it('should initialize with default state', async () => {
    const mockSocket = createMockSocket();
    const mockRefs = createMockRefs();

    const { result } = renderHook(() =>
      useStreamingMessages({
        socket: mockSocket,
        sessionId: 'test-session',
        ...mockRefs,
      })
    );

    await waitFor(() => {
      expect(result.current.messages).toEqual([]);
      expect(result.current.streaming).toBe(false);
      expect(result.current.backgroundProcessing).toBe(false);
      expect(result.current.thinking).toBe('');
      expect(result.current.contextTokens).toBeNull();
    });
  });

  it('should fetch user stats on mount', async () => {
    const mockSocket = createMockSocket();
    const mockRefs = createMockRefs();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        total_cost: 2.5,
        total_input_tokens: 2000,
        total_output_tokens: 1000,
        total_duration_ms: 10000,
        total_queries: 20,
        total_lines_of_code: 500,
        total_sessions: 5,
      }),
    });

    const { result } = renderHook(() =>
      useStreamingMessages({
        socket: mockSocket,
        sessionId: 'test-session',
        ...mockRefs,
      })
    );

    await waitFor(() => {
      expect(result.current.usageStats.totalCost).toBe(2.5);
      expect(result.current.usageStats.totalInputTokens).toBe(2000);
      expect(result.current.usageStats.queryCount).toBe(20);
    });
  });

  describe('Socket event: message_received', () => {
    it('should dispatch custom event on message_received', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();
      const eventSpy = jest.fn();

      window.addEventListener('ccplus_message_received', eventSpy);

      renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const messageReceivedHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'message_received'
      )?.[1];

      await act(async () => {
        messageReceivedHandler?.();
      });

      expect(eventSpy).toHaveBeenCalled();
      window.removeEventListener('ccplus_message_received', eventSpy);
    });
  });

  describe('Socket event: stream_active', () => {
    it('should set streaming to true on stream_active', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const streamActiveHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'stream_active'
      )?.[1];

      await act(async () => {
        streamActiveHandler?.({ session_id: 'test-session' });
      });

      expect(result.current.streaming).toBe(true);
    });

    it('should ignore stream_active from different session', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const streamActiveHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'stream_active'
      )?.[1];

      await act(async () => {
        streamActiveHandler?.({ session_id: 'different-session' });
      });

      expect(result.current.streaming).toBe(false);
    });
  });

  describe('Socket event: stream_content_sync', () => {
    it('should create new message on stream_content_sync if no streaming message exists', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const syncHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'stream_content_sync'
      )?.[1];

      await act(async () => {
        syncHandler?.({ content: 'Synced content', session_id: 'test-session' });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Synced content');
      expect(result.current.messages[0].streaming).toBe(true);
      expect(result.current.streaming).toBe(true);
    });

    it('should update existing streaming message on stream_content_sync', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];
      const syncHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'stream_content_sync'
      )?.[1];

      // Create initial streaming message
      await act(async () => {
        textDeltaHandler?.({ text: 'Initial', session_id: 'test-session' });
      });

      expect(result.current.messages.length).toBe(1);

      // Sync with new content
      await act(async () => {
        syncHandler?.({ content: 'Synced full content', session_id: 'test-session' });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Synced full content');
    });

    it('should ignore stream_content_sync from different session', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const syncHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'stream_content_sync'
      )?.[1];

      await act(async () => {
        syncHandler?.({ content: 'Synced content', session_id: 'different-session' });
      });

      expect(result.current.messages.length).toBe(0);
    });
  });

  describe('Socket event: thinking_delta', () => {
    it('should accumulate thinking text on thinking_delta', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const thinkingHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'thinking_delta'
      )?.[1];

      await act(async () => {
        thinkingHandler?.({ text: 'Thinking...' });
      });

      expect(result.current.thinking).toBe('Thinking...');

      await act(async () => {
        thinkingHandler?.({ text: ' more' });
      });

      expect(result.current.thinking).toBe('Thinking... more');
    });
  });

  describe('Socket event: text_delta', () => {
    it('should create new message on first text_delta', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];

      await act(async () => {
        textDeltaHandler?.({ text: 'Hello', session_id: 'test-session' });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Hello');
      expect(result.current.messages[0].role).toBe('assistant');
      expect(result.current.messages[0].streaming).toBe(true);
      expect(result.current.streaming).toBe(true);
      expect(result.current.backgroundProcessing).toBe(false);
    });

    it('should accumulate text on subsequent text_delta events', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];

      await act(async () => {
        textDeltaHandler?.({ text: 'Hello', session_id: 'test-session' });
      });

      await act(async () => {
        textDeltaHandler?.({ text: ' world', session_id: 'test-session' });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Hello world');
    });

    it('should clear thinking state on first text_delta', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const thinkingHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'thinking_delta'
      )?.[1];
      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];

      await act(async () => {
        thinkingHandler?.({ text: 'Thinking...' });
      });

      expect(result.current.thinking).toBe('Thinking...');

      await act(async () => {
        textDeltaHandler?.({ text: 'Response', session_id: 'test-session' });
      });

      expect(result.current.thinking).toBe('');
    });

    it('should ignore text_delta from different session', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];

      await act(async () => {
        textDeltaHandler?.({ text: 'Hello', session_id: 'different-session' });
      });

      expect(result.current.messages.length).toBe(0);
    });

    it('should handle multiple sequential messages with different message_index', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];

      // First message (index 0)
      await act(async () => {
        textDeltaHandler?.({ text: 'First', message_index: 0, session_id: 'test-session' });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('First');

      // Second message (index 1) - should finalize first and create new
      await act(async () => {
        textDeltaHandler?.({ text: 'Second', message_index: 1, session_id: 'test-session' });
      });

      expect(result.current.messages.length).toBe(2);
      expect(result.current.messages[0].streaming).toBe(false);
      expect(result.current.messages[1].content).toBe('Second');
      expect(result.current.messages[1].streaming).toBe(true);
    });
  });

  describe('Socket event: response_complete', () => {
    it('should finalize streaming message on response_complete', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];
      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      // Start streaming
      await act(async () => {
        textDeltaHandler?.({ text: 'Complete message', session_id: 'test-session' });
      });

      expect(result.current.messages[0].streaming).toBe(true);

      // Complete
      await act(async () => {
        responseCompleteHandler?.({
          session_id: 'test-session',
          sdk_session_id: 'final',
          input_tokens: 100,
          output_tokens: 50,
          cost: 0.01,
          duration_ms: 1000,
        });
      });

      expect(result.current.messages[0].streaming).toBe(false);
      expect(result.current.streaming).toBe(false);
    });

    it('should update context tokens from response_complete', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      await act(async () => {
        responseCompleteHandler?.({
          session_id: 'test-session',
          input_tokens: 5000,
        });
      });

      expect(result.current.contextTokens).toBe(5000);
    });

    it('should update context window size based on model', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      // Wait for initial fetch to complete
      await waitFor(() => {
        expect(result.current.usageStats.contextWindowSize).toBe(500_000);
      });

      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      // Non-final completion (sdk_session_id is null) to avoid fetching stats
      act(() => {
        responseCompleteHandler?.({
          session_id: 'test-session',
          model: 'claude-sonnet-4-6',
          sdk_session_id: null,
        });
      });

      // Wait for context window to update
      await waitFor(() => {
        expect(result.current.usageStats.contextWindowSize).toBe(1_000_000);
      });
      expect(result.current.usageStats.model).toBe('claude-sonnet-4-6');
    });

    it('should fetch user stats on final completion', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          total_cost: 5.0,
          total_input_tokens: 10000,
          total_output_tokens: 5000,
          total_duration_ms: 20000,
          total_queries: 50,
          total_lines_of_code: 1000,
          total_sessions: 10,
        }),
      });
      global.fetch = fetchSpy;

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      await act(async () => {
        responseCompleteHandler?.({
          session_id: 'test-session',
          sdk_session_id: 'final-session',
          model: 'sonnet',
        });
      });

      await waitFor(() => {
        expect(result.current.usageStats.totalCost).toBe(5.0);
        expect(result.current.usageStats.totalInputTokens).toBe(10000);
      });
    });

    it('should set backgroundProcessing if agents are still running on non-final completion', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();
      mockRefs.hasRunningAgents = jest.fn().mockReturnValue(true);

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];
      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      // Start streaming
      await act(async () => {
        textDeltaHandler?.({ text: 'Response', session_id: 'test-session' });
      });

      // Non-final completion (sdk_session_id is null or undefined)
      await act(async () => {
        responseCompleteHandler?.({
          session_id: 'test-session',
          sdk_session_id: null,
        });
      });

      await waitFor(() => {
        expect(result.current.backgroundProcessing).toBe(true);
      });
    });

    it('should create recovery message if no streaming message exists on response_complete', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      await act(async () => {
        responseCompleteHandler?.({
          session_id: 'test-session',
          content: 'Recovery content',
        });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Recovery content');
      expect(result.current.messages[0].streaming).toBe(false);
    });

    it('should ignore response_complete from different session', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];
      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      // Start streaming in test-session
      await act(async () => {
        textDeltaHandler?.({ text: 'Hello', session_id: 'test-session' });
      });

      expect(result.current.messages[0].streaming).toBe(true);

      // Complete from different session
      await act(async () => {
        responseCompleteHandler?.({
          session_id: 'different-session',
          sdk_session_id: 'final',
        });
      });

      // Message should still be streaming
      expect(result.current.messages[0].streaming).toBe(true);
    });

    it('should attach toolLog to finalized message on non-final completion', async () => {
      const mockSocket = createMockSocket();
      const mockToolEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-1',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
      };

      // Create mockRefs with toolLog already populated
      const mockRefs = createMockRefs();
      mockRefs.toolLogRef.current = [mockToolEvent];

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];
      const responseCompleteHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'response_complete'
      )?.[1];

      act(() => {
        textDeltaHandler?.({ text: 'Response', session_id: 'test-session' });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
        expect(result.current.messages[0].streaming).toBe(true);
      });

      // Non-final completion (sdk_session_id is null) - toolLogRef should NOT be cleared
      act(() => {
        responseCompleteHandler?.({
          session_id: 'test-session',
          sdk_session_id: null,
        });
      });

      // Wait for message to be finalized
      await waitFor(() => {
        expect(result.current.messages[0].streaming).toBe(false);
      });

      // The toolLog should have been attached
      const message = result.current.messages[0];
      expect(message.toolLog).toEqual([mockToolEvent]);
    });
  });

  describe('Socket event: error', () => {
    it('should add error message on error event', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const errorHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1];

      await act(async () => {
        errorHandler?.({ message: 'Something went wrong' });
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Error: Something went wrong');
      expect(result.current.messages[0].role).toBe('assistant');
      expect(result.current.streaming).toBe(false);
      expect(result.current.backgroundProcessing).toBe(false);
    });

    it('should reset streaming state on error', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];
      const errorHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1];

      // Start streaming
      await act(async () => {
        textDeltaHandler?.({ text: 'Starting...', session_id: 'test-session' });
      });

      expect(result.current.streaming).toBe(true);

      // Trigger error
      await act(async () => {
        errorHandler?.({ message: 'Error occurred' });
      });

      expect(result.current.streaming).toBe(false);
      expect(result.current.backgroundProcessing).toBe(false);
    });
  });

  describe('Socket event: compact_boundary', () => {
    it('should add compact boundary indicator message', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const compactHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'compact_boundary'
      )?.[1];

      await act(async () => {
        compactHandler?.();
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('↻ Context compacted');
      expect(result.current.messages[0].isCompactBoundary).toBe(true);
      expect(result.current.messages[0].role).toBe('assistant');
    });

    it('should add multiple compact boundaries', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const compactHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'compact_boundary'
      )?.[1];

      await act(async () => {
        compactHandler?.();
      });

      await act(async () => {
        compactHandler?.();
      });

      expect(result.current.messages.length).toBe(2);
      expect(result.current.messages[0].isCompactBoundary).toBe(true);
      expect(result.current.messages[1].isCompactBoundary).toBe(true);
    });
  });

  describe('Background processing cleanup', () => {
    it('should clear backgroundProcessing if no agents are running', async () => {
      jest.useFakeTimers();
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();
      mockRefs.hasRunningAgents = jest.fn().mockReturnValue(false);

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      // Manually set backgroundProcessing
      await act(async () => {
        result.current.setBackgroundProcessing(true);
      });

      expect(result.current.backgroundProcessing).toBe(true);

      // Fast-forward timer
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(result.current.backgroundProcessing).toBe(false);

      jest.useRealTimers();
    });

    it('should not clear backgroundProcessing if agents are running', async () => {
      jest.useFakeTimers();
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();
      mockRefs.hasRunningAgents = jest.fn().mockReturnValue(true);

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      // Manually set backgroundProcessing
      await act(async () => {
        result.current.setBackgroundProcessing(true);
      });

      expect(result.current.backgroundProcessing).toBe(true);

      // Fast-forward timer
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      // Should still be true because agents are running
      expect(result.current.backgroundProcessing).toBe(true);

      jest.useRealTimers();
    });

    it('should not clear backgroundProcessing if streaming is active', async () => {
      jest.useFakeTimers();
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      // Set both streaming and backgroundProcessing
      await act(async () => {
        result.current.setStreaming(true);
        result.current.setBackgroundProcessing(true);
      });

      expect(result.current.backgroundProcessing).toBe(true);

      // Fast-forward timer
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      // Should still be true because streaming is active
      expect(result.current.backgroundProcessing).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('Socket cleanup', () => {
    it('should unregister all event listeners on unmount', () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { unmount } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      unmount();

      expect(mockSocket.off).toHaveBeenCalledWith('message_received');
      expect(mockSocket.off).toHaveBeenCalledWith('stream_active');
      expect(mockSocket.off).toHaveBeenCalledWith('stream_content_sync');
      expect(mockSocket.off).toHaveBeenCalledWith('thinking_delta');
      expect(mockSocket.off).toHaveBeenCalledWith('text_delta');
      expect(mockSocket.off).toHaveBeenCalledWith('response_complete');
      expect(mockSocket.off).toHaveBeenCalledWith('error');
      expect(mockSocket.off).toHaveBeenCalledWith('compact_boundary');
    });
  });

  describe('Exported refs', () => {
    it('should expose all internal refs for external use', () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      expect(result.current.streamingContentRef).toBeDefined();
      expect(result.current.streamingIdRef).toBeDefined();
      expect(result.current.responseCompleteRef).toBeDefined();
      expect(result.current.messageIndexRef).toBeDefined();
      expect(result.current.completionFinalizedRef).toBeDefined();
      expect(result.current.syncInProgressRef).toBeDefined();
      expect(result.current.streamActiveRef).toBeDefined();
      expect(result.current.awaitingDeltaAfterRestore).toBeDefined();
      expect(result.current.streamingRef).toBeDefined();
      expect(result.current.backgroundProcessingRef).toBeDefined();
      expect(result.current.thinkingRef).toBeDefined();
      expect(result.current.messagesRef).toBeDefined();
    });

    it('should sync state refs with state values', async () => {
      const mockSocket = createMockSocket();
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: mockSocket,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      const textDeltaHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'text_delta'
      )?.[1];

      await act(async () => {
        textDeltaHandler?.({ text: 'Test', session_id: 'test-session' });
      });

      // Verify refs are synced
      await waitFor(() => {
        expect(result.current.streamingRef.current).toBe(result.current.streaming);
        expect(result.current.messagesRef.current).toEqual(result.current.messages);
      });
    });
  });

  describe('Null socket handling', () => {
    it('should handle null socket gracefully', () => {
      const mockRefs = createMockRefs();

      const { result } = renderHook(() =>
        useStreamingMessages({
          socket: null,
          sessionId: 'test-session',
          ...mockRefs,
        })
      );

      expect(result.current.messages).toEqual([]);
      expect(result.current.streaming).toBe(false);
    });
  });
});
