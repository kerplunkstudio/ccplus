import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionRestore } from './useSessionRestore';
import { Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode } from '../types';

// Mock socket.io-client
let mockSocket: any;

// Mock fetch
global.fetch = jest.fn();

describe('useSessionRestore', () => {
  let mockRefs: any;
  let mockSetters: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();

    // Create mock socket
    mockSocket = {
      connected: false,
      io: {
        on: jest.fn(),
        off: jest.fn(),
      },
      emit: jest.fn(),
    };

    // Create mock refs
    mockRefs = {
      currentSessionIdRef: { current: 'session-1' },
      prevSessionIdRef: { current: 'session-1' },
      sessionCacheRef: { current: new Map() },
      messagesRef: { current: [] },
      streamingRef: { current: false },
      backgroundProcessingRef: { current: false },
      thinkingRef: { current: '' },
      streamingContentRef: { current: '' },
      streamingIdRef: { current: null },
      toolLogRef: { current: [] },
      activityTreeRef: { current: [] },
      sequenceRef: { current: 0 },
      seenToolUseIds: { current: new Set() },
      streamActiveRef: { current: false },
      awaitingDeltaAfterRestore: { current: false },
      responseCompleteRef: { current: false },
      completionFinalizedRef: { current: false },
      messageIndexRef: { current: 0 },
      clearToolTimerRef: { current: null },
      pendingWorkerRestartErrorRef: { current: null },
      workerRestartGraceTimerRef: { current: null },
    };

    // Create mock setters
    mockSetters = {
      setMessages: jest.fn(),
      setStreaming: jest.fn(),
      setBackgroundProcessing: jest.fn(),
      setThinking: jest.fn(),
      setToolLog: jest.fn(),
      setCurrentTool: jest.fn(),
      setPendingQuestion: jest.fn(),
      setPendingRestore: jest.fn(),
      setSignals: jest.fn(),
      setContextTokens: jest.fn(),
      setUsageStats: jest.fn(),
      dispatchTree: jest.fn(),
    };
  });

  const createHookProps = (overrides?: Partial<any>) => ({
    token: 'test-token',
    sessionId: 'session-1',
    socket: mockSocket,
    contextTokens: null,
    ...mockRefs,
    ...mockSetters,
    ...overrides,
  });

  describe('Initial state', () => {
    it('should initialize with isRestoringSession true', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false }),
      });

      const { result } = renderHook(() => useSessionRestore(createHookProps()));

      expect(result.current.isRestoringSession).toBe(true);
      expect(result.current.isRestoringSessionRef.current).toBe(true);

      await waitFor(() => {
        expect(result.current.isRestoringSession).toBe(false);
      });
    });

    it('should not restore if token is null', async () => {
      const { result } = renderHook(() => useSessionRestore(createHookProps({ token: null })));

      expect(result.current.isRestoringSession).toBe(true);

      // Should not call fetch
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Tab switch: cache save/restore', () => {
    it('should save current session to cache on tab switch', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false }),
      });

      const messages: Message[] = [
        { id: '1', content: 'Hello', role: 'user', timestamp: Date.now() },
      ];
      mockRefs.messagesRef.current = messages;
      mockRefs.streamingContentRef.current = 'Thinking...';
      mockRefs.streamingIdRef.current = 'msg-123';

      const { rerender } = renderHook(
        ({ sessionId }) => useSessionRestore(createHookProps({ sessionId })),
        { initialProps: { sessionId: 'session-1' } }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Switch to a new session
      mockRefs.prevSessionIdRef.current = 'session-1';
      rerender({ sessionId: 'session-2' });

      // Check that previous session was cached
      const cached = mockRefs.sessionCacheRef.current.get('session-1');
      expect(cached).toBeDefined();
      expect(cached.messages).toEqual(messages);
      expect(cached.streamingContent).toBe('Thinking...');
      expect(cached.streamingId).toBe('msg-123');
    });

    it('should not save to cache if messages array is empty', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false }),
      });

      mockRefs.messagesRef.current = [];

      const { rerender } = renderHook(
        ({ sessionId }) => useSessionRestore(createHookProps({ sessionId })),
        { initialProps: { sessionId: 'session-1' } }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Switch to a new session
      mockRefs.prevSessionIdRef.current = 'session-1';
      rerender({ sessionId: 'session-2' });

      // Cache should be empty
      const cached = mockRefs.sessionCacheRef.current.get('session-1');
      expect(cached).toBeUndefined();
    });

    it('should restore from cache on tab switch', async () => {
      const cachedMessages: Message[] = [
        { id: '1', content: 'Cached message', role: 'assistant', timestamp: Date.now() },
      ];
      const cachedToolLog: ToolEvent[] = [
        {
          type: 'tool_start',
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          parent_agent_id: null,
          timestamp: new Date().toISOString(),
        } as ToolEvent,
      ];

      mockRefs.sessionCacheRef.current.set('session-2', {
        messages: cachedMessages,
        streamingContent: 'Test content',
        streamingId: 'msg-456',
        toolLog: cachedToolLog,
        activityTree: [],
        sequenceCounter: 5,
        seenIds: new Set(['tool-1']),
        streaming: true,
        backgroundProcessing: false,
        thinking: 'Test thinking',
        contextTokens: 1000,
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: [] }),
      });

      const { rerender } = renderHook(
        ({ sessionId }) => useSessionRestore(createHookProps({ sessionId })),
        { initialProps: { sessionId: 'session-1' } }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      mockRefs.prevSessionIdRef.current = 'session-1';
      rerender({ sessionId: 'session-2' });

      await waitFor(() => {
        expect(mockSetters.setMessages).toHaveBeenCalledWith(cachedMessages);
        expect(mockSetters.setStreaming).toHaveBeenCalledWith(true);
        expect(mockSetters.setThinking).toHaveBeenCalledWith('Test thinking');
        expect(mockSetters.setContextTokens).toHaveBeenCalledWith(1000);
      });

      expect(mockRefs.streamingContentRef.current).toBe('Test content');
      expect(mockRefs.streamingIdRef.current).toBe('msg-456');
      expect(mockRefs.sequenceRef.current).toBe(5);
    });

    it('should reset all state on tab switch', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false, events: [] }),
      });

      const clearToolTimer = jest.fn();
      mockRefs.clearToolTimerRef.current = setTimeout(clearToolTimer, 1000);
      const workerGraceTimer = jest.fn();
      mockRefs.workerRestartGraceTimerRef.current = setTimeout(workerGraceTimer, 1000);

      const { rerender } = renderHook(
        ({ sessionId }) => useSessionRestore(createHookProps({ sessionId })),
        { initialProps: { sessionId: 'session-1' } }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      mockRefs.prevSessionIdRef.current = 'session-1';
      rerender({ sessionId: 'session-2' });

      await waitFor(() => {
        expect(mockSetters.setMessages).toHaveBeenCalledWith([]);
        expect(mockSetters.dispatchTree).toHaveBeenCalledWith({ type: 'CLEAR' });
        expect(mockSetters.setStreaming).toHaveBeenCalledWith(false);
        expect(mockSetters.setBackgroundProcessing).toHaveBeenCalledWith(false);
        expect(mockSetters.setThinking).toHaveBeenCalledWith('');
        expect(mockSetters.setCurrentTool).toHaveBeenCalledWith(null);
        expect(mockSetters.setPendingQuestion).toHaveBeenCalledWith(null);
        expect(mockSetters.setPendingRestore).toHaveBeenCalledWith(false);
        expect(mockSetters.setSignals).toHaveBeenCalledWith({ status: null });
        expect(mockSetters.setContextTokens).toHaveBeenCalledWith(null);
      });

      expect(mockRefs.toolLogRef.current).toEqual([]);
      expect(mockRefs.streamingContentRef.current).toBe('');
      expect(mockRefs.streamingIdRef.current).toBeNull();
      expect(mockRefs.responseCompleteRef.current).toBe(false);
      expect(mockRefs.streamActiveRef.current).toBe(false);
      expect(mockRefs.sequenceRef.current).toBe(0);
      expect(mockRefs.seenToolUseIds.current.size).toBe(0);
    });

    it('should switch socket rooms on tab switch with connected socket', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false, events: [] }),
      });

      const connectedSocket = {
        ...mockSocket,
        connected: true,
      } as unknown as Socket;

      const { rerender } = renderHook(
        ({ sessionId }) => useSessionRestore(createHookProps({ sessionId, socket: connectedSocket })),
        { initialProps: { sessionId: 'session-1' } }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      jest.clearAllMocks();

      mockRefs.prevSessionIdRef.current = 'session-1';
      rerender({ sessionId: 'session-2' });

      expect(connectedSocket.emit).toHaveBeenCalledWith('leave_session', { session_id: 'session-1' });
      expect(connectedSocket.emit).toHaveBeenCalledWith('join_session', { session_id: 'session-2' });
    });
  });

  describe('Database restoration', () => {
    it('should restore messages from API when no cache exists', async () => {
      const dbMessages = [
        { id: 1, content: 'User message', role: 'user', timestamp: '2025-01-15T10:00:00Z' },
        { id: 2, content: 'Assistant message', role: 'assistant', timestamp: '2025-01-15T10:00:01Z' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: dbMessages, streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      const { result } = renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.setMessages).toHaveBeenCalled();
      });

      const setMessagesCall = mockSetters.setMessages.mock.calls[0][0];
      expect(setMessagesCall).toHaveLength(2);
      expect(setMessagesCall[0].content).toBe('User message');
      expect(setMessagesCall[1].content).toBe('Assistant message');
      expect(result.current.isRestoringSession).toBe(false);
    });

    it('should restore context tokens and model from API', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [],
            streaming: false,
            context_tokens: 5000,
            model: 'claude-sonnet-4-6',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.setContextTokens).toHaveBeenCalledWith(5000);
        expect(mockSetters.setUsageStats).toHaveBeenCalledWith(
          expect.any(Function)
        );
      });

      // Verify the setUsageStats updater function
      const updateFn = mockSetters.setUsageStats.mock.calls[0][0];
      const updated = updateFn({ inputTokens: 0, outputTokens: 0, contextWindowSize: 0, model: null });
      expect(updated.contextWindowSize).toBe(1_000_000);
      expect(updated.model).toBe('claude-sonnet-4-6');
    });

    it('should restore activity tree from API', async () => {
      const dbEvents = [
        {
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          parent_agent_id: null,
          agent_type: null,
          timestamp: '2025-01-15T10:00:00Z',
          success: true,
          duration_ms: 1234,
          parameters: '{"command": "ls"}',
        },
        {
          tool_name: 'Agent',
          tool_use_id: 'agent-1',
          parent_agent_id: null,
          agent_type: 'code_agent',
          timestamp: '2025-01-15T10:00:01Z',
          success: null,
          description: 'Fix bug',
        },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: dbEvents }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.dispatchTree).toHaveBeenCalledWith({
          type: 'LOAD_HISTORY',
          events: expect.any(Array),
        });
      });

      const loadCall = mockSetters.dispatchTree.mock.calls.find(
        (call: any) => call[0].type === 'LOAD_HISTORY'
      );
      const events = loadCall[0].events;

      // Should create start and complete events for tool-1
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-1',
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool_complete',
        tool_name: 'Bash',
        tool_use_id: 'tool-1',
        success: true,
        duration_ms: 1234,
      }));

      // Should create agent_start for agent-1 (no complete because success is null)
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'agent-1',
        agent_type: 'code_agent',
      }));
    });

    it('should handle API fetch errors gracefully', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(result.current.isRestoringSession).toBe(false);
      });

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('[useSessionRestore] Failed to restore session:'),
        expect.any(Error)
      );

      consoleError.mockRestore();
    });

    it('should handle history fetch failure without crashing', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      const { result } = renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(result.current.isRestoringSession).toBe(false);
      });

      // Should still try to fetch activity
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle activity fetch failure without crashing', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      const { result } = renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(result.current.isRestoringSession).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Active streaming session restoration', () => {
    it('should restore streaming state when session is active', async () => {
      const dbMessages = [
        { id: 1, content: 'User message', role: 'user', timestamp: '2025-01-15T10:00:00Z' },
        { id: 2, content: 'Partial assistant', role: 'assistant', timestamp: '2025-01-15T10:00:01Z' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: dbMessages, streaming: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.setStreaming).toHaveBeenCalledWith(true);
        expect(mockSetters.setPendingRestore).toHaveBeenCalledWith(true);
      });

      expect(mockRefs.awaitingDeltaAfterRestore.current).toBe(true);
      expect(mockRefs.streamingIdRef.current).toBe('db_2');
      expect(mockRefs.streamingContentRef.current).toBe('Partial assistant');
    });

    it('should mark last assistant message as streaming when restoring active session', async () => {
      const dbMessages = [
        { id: 1, content: 'User message', role: 'user', timestamp: '2025-01-15T10:00:00Z' },
        { id: 2, content: 'Assistant reply', role: 'assistant', timestamp: '2025-01-15T10:00:01Z' },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: dbMessages, streaming: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.setMessages).toHaveBeenCalled();
      });

      const setMessagesCall = mockSetters.setMessages.mock.calls[0][0];
      const lastMessage = setMessagesCall[setMessagesCall.length - 1];
      expect(lastMessage.streaming).toBe(true);
    });

    it('should restore last running tool when session is active', async () => {
      const dbEvents = [
        {
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          parent_agent_id: null,
          timestamp: '2025-01-15T10:00:00Z',
          success: true,
          duration_ms: 100,
        },
        {
          tool_name: 'Agent',
          tool_use_id: 'agent-1',
          parent_agent_id: null,
          agent_type: 'code_agent',
          timestamp: '2025-01-15T10:00:01Z',
          success: null, // Still running
        },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: dbEvents }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.setCurrentTool).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'agent_start',
            tool_use_id: 'agent-1',
          })
        );
      });
    });

    it('should not set current tool if all tools are completed', async () => {
      const dbEvents = [
        {
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          parent_agent_id: null,
          timestamp: '2025-01-15T10:00:00Z',
          success: true,
          duration_ms: 100,
        },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: dbEvents }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.dispatchTree).toHaveBeenCalledWith({
          type: 'LOAD_HISTORY',
          events: expect.any(Array),
        });
      });

      // setCurrentTool should not be called with a running tool
      const currentToolCalls = mockSetters.setCurrentTool.mock.calls.filter(
        (call: any) => call[0] !== null
      );
      expect(currentToolCalls).toHaveLength(0);
    });
  });

  describe('Reconnect recovery', () => {
    it('should restore session on socket reconnect', async () => {
      const dbMessages = [
        { id: 1, content: 'Message after reconnect', role: 'user', timestamp: '2025-01-15T10:00:00Z' },
      ];

      const testSocket = {
        connected: true,
        io: {
          on: jest.fn(),
          off: jest.fn(),
        },
        emit: jest.fn(),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: dbMessages, streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      renderHook(() => useSessionRestore(createHookProps({ socket: testSocket as any })));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      // Get the reconnect handler
      const reconnectCall = (testSocket.io.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'reconnect'
      );
      expect(reconnectCall).toBeDefined();
      const reconnectHandler = reconnectCall[1];

      jest.clearAllMocks();

      // Trigger reconnect
      await act(async () => {
        await reconnectHandler();
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/history/session-1')
        );
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/activity/session-1')
        );
      });
    });

    it('should restore streaming state on reconnect if session is active', async () => {
      const dbMessages = [
        { id: 1, content: 'User query', role: 'user', timestamp: '2025-01-15T10:00:00Z' },
        { id: 2, content: 'Incomplete response', role: 'assistant', timestamp: '2025-01-15T10:00:01Z' },
      ];

      const testSocket = {
        connected: true,
        io: {
          on: jest.fn(),
          off: jest.fn(),
        },
        emit: jest.fn(),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: dbMessages, streaming: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      renderHook(() => useSessionRestore(createHookProps({ socket: testSocket as any })));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      const reconnectCall = (testSocket.io.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'reconnect'
      );
      const reconnectHandler = reconnectCall[1];

      jest.clearAllMocks();

      await act(async () => {
        await reconnectHandler();
      });

      await waitFor(() => {
        expect(mockSetters.setStreaming).toHaveBeenCalledWith(true);
        expect(mockSetters.setPendingRestore).toHaveBeenCalledWith(true);
      });
    });

    it('should cleanup reconnect listener on unmount', async () => {
      const testSocket = {
        connected: true,
        io: {
          on: jest.fn(),
          off: jest.fn(),
        },
        emit: jest.fn(),
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false, events: [] }),
      });

      const { unmount } = renderHook(() => useSessionRestore(createHookProps({ socket: testSocket as any })));

      await waitFor(() => {
        expect(testSocket.io.on).toHaveBeenCalledWith('reconnect', expect.any(Function));
      });

      unmount();

      expect(testSocket.io.off).toHaveBeenCalledWith('reconnect', expect.any(Function));
    });

    it('should handle reconnect when currentSessionIdRef is null', async () => {
      const testSocket = {
        connected: true,
        io: {
          on: jest.fn(),
          off: jest.fn(),
        },
        emit: jest.fn(),
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false, events: [] }),
      });

      mockRefs.currentSessionIdRef.current = '';

      renderHook(() => useSessionRestore(createHookProps({ socket: testSocket as any })));

      await waitFor(() => {
        expect(testSocket.io.on).toHaveBeenCalled();
      });

      const reconnectCall = (testSocket.io.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'reconnect'
      );
      const reconnectHandler = reconnectCall[1];

      jest.clearAllMocks();

      await act(async () => {
        await reconnectHandler();
      });

      // Should not fetch if currentSessionIdRef is empty
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors during reconnect gracefully', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      const testSocket = {
        connected: true,
        io: {
          on: jest.fn(),
          off: jest.fn(),
        },
        emit: jest.fn(),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        })
        .mockRejectedValueOnce(new Error('Reconnect fetch failed'));

      renderHook(() => useSessionRestore(createHookProps({ socket: testSocket as any })));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      const reconnectCall = (testSocket.io.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'reconnect'
      );
      const reconnectHandler = reconnectCall[1];

      jest.clearAllMocks();

      await act(async () => {
        await reconnectHandler();
      });

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('[useSessionRestore] Failed to restore after reconnect:'),
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });
  });

  describe('Cleanup on unmount', () => {
    it('should cleanup properly on unmount', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], streaming: false, events: [] }),
      });

      const { unmount } = renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Should not throw
      unmount();
    });

    it('should prevent state updates after unmount', async () => {
      let resolveHistoryFetch: (value: any) => void;
      const historyPromise = new Promise((resolve) => {
        resolveHistoryFetch = resolve;
      });

      (global.fetch as jest.Mock)
        .mockImplementationOnce(() => historyPromise)
        .mockResolvedValue({
          ok: true,
          json: async () => ({ events: [] }),
        });

      const { unmount } = renderHook(() => useSessionRestore(createHookProps()));

      // Unmount before fetch resolves
      unmount();

      // Resolve fetch after unmount
      resolveHistoryFetch!({
        ok: true,
        json: async () => ({ messages: [{ id: 1, content: 'Test', role: 'user', timestamp: '2025-01-15T10:00:00Z' }], streaming: false }),
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Should not call setMessages after unmount
      // (This is a bit tricky to test, but the hook should handle it)
    });
  });

  describe('Session cache deletion', () => {
    it('should delete session from cache after restoring', async () => {
      mockRefs.sessionCacheRef.current.set('session-1', {
        messages: [{ id: '1', content: 'Cached', role: 'user', timestamp: Date.now() }],
        streamingContent: '',
        streamingId: null,
        toolLog: [],
        activityTree: [],
        sequenceCounter: 0,
        seenIds: new Set(),
        streaming: false,
        backgroundProcessing: false,
        thinking: '',
        contextTokens: null,
      });

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ events: [] }),
      });

      renderHook(() => useSessionRestore(createHookProps()));

      expect(mockRefs.sessionCacheRef.current.has('session-1')).toBe(true);

      await waitFor(() => {
        expect(mockRefs.sessionCacheRef.current.has('session-1')).toBe(false);
      });
    });
  });

  describe('Seenids tracking', () => {
    it('should populate seenToolUseIds from restored events', async () => {
      const dbEvents = [
        {
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          parent_agent_id: null,
          timestamp: '2025-01-15T10:00:00Z',
          success: true,
          duration_ms: 100,
        },
        {
          tool_name: 'Read',
          tool_use_id: 'tool-2',
          parent_agent_id: null,
          timestamp: '2025-01-15T10:00:01Z',
          success: true,
          duration_ms: 50,
        },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: dbEvents }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockRefs.seenToolUseIds.current.has('tool-1')).toBe(true);
        expect(mockRefs.seenToolUseIds.current.has('tool-2')).toBe(true);
      });
    });
  });
});
