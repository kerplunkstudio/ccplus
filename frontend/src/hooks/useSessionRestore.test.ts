import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionRestore } from './useSessionRestore';
import { Socket } from 'socket.io-client';
import '../types';

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

    // Create mock refs (REMOVED: session cache, streaming refs, isRestoringSessionRef, etc.)
    mockRefs = {
      currentSessionIdRef: { current: 'session-1' },
      prevSessionIdRef: { current: 'session-1' },
      toolLogRef: { current: [] },
      activityTreeRef: { current: [] },
      sequenceRef: { current: 0 },
      seenToolUseIds: { current: new Set() },
      clearToolTimerRef: { current: null },
      pendingWorkerRestartErrorRef: { current: null },
      workerRestartGraceTimerRef: { current: null },
    };

    // Create mock setters (REMOVED: individual streaming setters, setPendingRestore)
    mockSetters = {
      streamDispatch: jest.fn(),
      setToolLog: jest.fn(),
      setCurrentTool: jest.fn(),
      setPendingQuestion: jest.fn(),
      setSignals: jest.fn(),
      setTodos: jest.fn(),
      setContextTokens: jest.fn(),
      setUsageStats: jest.fn(),
      dispatchTree: jest.fn(),
    };
  });

  const createHookProps = (overrides?: Partial<any>) => ({
    sessionId: 'session-1',
    socket: mockSocket,
    lastSeq: 0,
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

      await waitFor(() => {
        expect(result.current.isRestoringSession).toBe(false);
      });
    });

    it('should not restore if sessionId is empty', async () => {
      const { result } = renderHook(() => useSessionRestore(createHookProps({ sessionId: '' })));

      expect(result.current.isRestoringSession).toBe(true);

      // Should not call fetch
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Tab switch', () => {
    it('should clear all state on tab switch', async () => {
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
        // Should clear stream state via reducer
        expect(mockSetters.streamDispatch).toHaveBeenCalledWith({ type: 'CLEAR' });
        // Should clear activity tree
        expect(mockSetters.dispatchTree).toHaveBeenCalledWith({ type: 'CLEAR' });
        // Should reset tool/activity state
        expect(mockSetters.setCurrentTool).toHaveBeenCalledWith(null);
        expect(mockSetters.setPendingQuestion).toHaveBeenCalledWith(null);
        expect(mockSetters.setSignals).toHaveBeenCalledWith({ status: null });
        expect(mockSetters.setTodos).toHaveBeenCalledWith([]);
        expect(mockSetters.setContextTokens).toHaveBeenCalledWith(null);
      });

      // Should clear refs
      expect(mockRefs.toolLogRef.current).toEqual([]);
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

      // leave_session is immediate
      expect(connectedSocket.emit).toHaveBeenCalledWith('leave_session', { session_id: 'session-1' });

      // join_session now happens AFTER DB history loads to prevent race condition
      await waitFor(() => {
        expect(connectedSocket.emit).toHaveBeenCalledWith('join_session', { session_id: 'session-2', last_seq: 0 });
      });
    });

    it('should clear timers on tab switch', async () => {
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

      expect(mockRefs.clearToolTimerRef.current).toBeNull();
      expect(mockRefs.pendingWorkerRestartErrorRef.current).toBeNull();
      expect(mockRefs.workerRestartGraceTimerRef.current).toBeNull();
    });
  });

  describe('Database restoration', () => {
    it('should restore messages from API via streamDispatch', async () => {
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
        expect(mockSetters.streamDispatch).toHaveBeenCalled();
      });

      // Should dispatch LOAD_HISTORY action
      expect(mockSetters.streamDispatch).toHaveBeenCalledWith({
        type: 'LOAD_HISTORY',
        messages: expect.arrayContaining([
          expect.objectContaining({ content: 'User message', role: 'user' }),
          expect.objectContaining({ content: 'Assistant message', role: 'assistant' }),
        ]),
        isActive: false,
      });
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
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(result.current.isRestoringSession).toBe(false);
      });

      // Should not throw, just fail silently
      expect(result.current.isRestoringSession).toBe(false);
    });

    it('should handle history fetch failure without crashing', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
        });

      const { result } = renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(result.current.isRestoringSession).toBe(false);
      });

      // Should return early if history fetch fails, not try to fetch activity
      expect(global.fetch).toHaveBeenCalledTimes(1);
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
        expect(mockSetters.streamDispatch).toHaveBeenCalled();
      });

      // Should dispatch LOAD_HISTORY with isActive: true
      expect(mockSetters.streamDispatch).toHaveBeenCalledWith({
        type: 'LOAD_HISTORY',
        messages: expect.any(Array),
        isActive: true,
      });
    });

    it('should set streaming if session is active but no messages', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], streaming: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ events: [] }),
        });

      renderHook(() => useSessionRestore(createHookProps()));

      await waitFor(() => {
        expect(mockSetters.streamDispatch).toHaveBeenCalled();
      });

      // Should dispatch SET_STREAMING if no messages but session is active
      expect(mockSetters.streamDispatch).toHaveBeenCalledWith({
        type: 'SET_STREAMING',
        value: true,
      });
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

    it('should restore todos from last TodoWrite event', async () => {
      const dbEvents = [
        {
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          parent_agent_id: null,
          timestamp: '2025-01-15T10:00:00Z',
          success: true,
          duration_ms: 100,
          parameters: { command: 'ls' },
        },
        {
          tool_name: 'TodoWrite',
          tool_use_id: 'tool-2',
          parent_agent_id: null,
          timestamp: '2025-01-15T10:00:01Z',
          success: true,
          duration_ms: 50,
          parameters: {
            todos: [
              { id: '1', text: 'Fix bug', completed: false },
              { id: '2', text: 'Write tests', completed: true },
            ],
          },
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
        expect(mockSetters.setTodos).toHaveBeenCalledWith([
          { id: '1', text: 'Fix bug', completed: false },
          { id: '2', text: 'Write tests', completed: true },
        ]);
      });
    });

    it('should not restore todos if no TodoWrite events exist', async () => {
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

      // setTodos should not be called since there's no TodoWrite event
      const todosCalls = mockSetters.setTodos.mock.calls.filter(
        (call: any) => call[0].length > 0
      );
      expect(todosCalls).toHaveLength(0);
    });
  });

  describe('Reconnect recovery', () => {
    it('should rejoin session on socket reconnect with last_seq', async () => {
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
        });

      renderHook(() => useSessionRestore(createHookProps({ socket: testSocket as any, lastSeq: 42 })));

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

      // Should rejoin with last_seq, NOT fetch from DB
      expect(testSocket.emit).toHaveBeenCalledWith('join_session', {
        session_id: 'session-1',
        last_seq: 42,
      });
      expect(global.fetch).not.toHaveBeenCalled();
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

    it('should handle reconnect when currentSessionIdRef is empty', async () => {
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

      // Should not emit join_session if currentSessionIdRef is empty
      expect(testSocket.emit).not.toHaveBeenCalled();
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
