import { renderHook, act } from '@testing-library/react';
import { useToolEvents } from './useToolEvents';
import { ToolEvent } from '../types';

// Mock Socket.IO
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockSocket = {
  on: mockOn,
  off: mockOff,
} as any;

describe('useToolEvents', () => {
  let mockProps: any;
  let toolLogRef: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    toolLogRef = { current: [] };

    mockProps = {
      socket: mockSocket,
      dispatchTree: jest.fn(),
      currentSessionIdRef: { current: 'test-session-123' },
      streamingIdRef: { current: null },
      streamingContentRef: { current: '' },
      setMessages: jest.fn(),
      setStreaming: jest.fn(),
      sequenceRef: { current: 0 },
      seenToolUseIds: { current: new Set() },
      toolLogRef,
    };
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Socket event registration', () => {
    it('should register all socket event listeners on mount', () => {
      renderHook(() => useToolEvents(mockProps));

      expect(mockOn).toHaveBeenCalledWith('tool_event', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('user_question', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('signal', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('tool_progress', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('rate_limit', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('prompt_suggestions', expect.any(Function));
    });

    it('should unregister all socket event listeners on unmount', () => {
      const { unmount } = renderHook(() => useToolEvents(mockProps));

      unmount();

      expect(mockOff).toHaveBeenCalledWith('tool_event');
      expect(mockOff).toHaveBeenCalledWith('user_question');
      expect(mockOff).toHaveBeenCalledWith('signal');
      expect(mockOff).toHaveBeenCalledWith('tool_progress');
      expect(mockOff).toHaveBeenCalledWith('rate_limit');
      expect(mockOff).toHaveBeenCalledWith('prompt_suggestions');
    });

    it('should not register listeners when socket is null', () => {
      renderHook(() => useToolEvents({ ...mockProps, socket: null }));

      expect(mockOn).not.toHaveBeenCalled();
    });
  });

  describe('Tool event processing - tool_start', () => {
    it('should process tool_start event', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const toolEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-123',
        parent_agent_id: null,
        parameters: { command: 'ls' },
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(toolEvent);
      });

      expect(mockProps.dispatchTree).toHaveBeenCalledWith({
        type: 'TOOL_START',
        event: toolEvent,
        sequence: 1,
      });
      expect(mockProps.setStreaming).toHaveBeenCalledWith(true);
      expect(toolLogRef.current).toHaveLength(1);
      expect(toolLogRef.current[0]).toEqual(toolEvent);
    });

    it('should finalize streaming message when tool_start arrives', () => {
      mockProps.streamingIdRef.current = 'streaming-msg-123';
      mockProps.streamingContentRef.current = 'Some streaming content';

      renderHook(() => useToolEvents(mockProps));

      const toolEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool-456',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(toolEvent);
      });

      expect(mockProps.setMessages).toHaveBeenCalledWith(expect.any(Function));
      expect(mockProps.streamingIdRef.current).toBeNull();
      expect(mockProps.streamingContentRef.current).toBe('');
    });

    it('should ignore duplicate tool_use_id', () => {
      mockProps.seenToolUseIds.current.add('tool-duplicate');

      renderHook(() => useToolEvents(mockProps));

      const toolEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-duplicate',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(toolEvent);
      });

      expect(mockProps.dispatchTree).not.toHaveBeenCalled();
      expect(toolLogRef.current).toHaveLength(0);
    });

    it('should ignore tool_start from different session', () => {
      renderHook(() => useToolEvents(mockProps));

      const toolEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-789',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'different-session',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(toolEvent);
      });

      expect(mockProps.dispatchTree).not.toHaveBeenCalled();
    });
  });

  describe('Tool event processing - tool_complete', () => {
    it('should process tool_complete event', () => {
      toolLogRef.current = [{
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-complete-123',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      }];

      renderHook(() => useToolEvents(mockProps));

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Bash',
        tool_use_id: 'tool-complete-123',
        parent_agent_id: null,
        success: true,
        duration_ms: 1234,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(completeEvent);
      });

      expect(mockProps.dispatchTree).toHaveBeenCalledWith({
        type: 'TOOL_COMPLETE',
        event: completeEvent,
      });

      expect(toolLogRef.current[0]).toMatchObject({
        type: 'tool_complete',
        success: true,
        duration_ms: 1234,
      });
    });

    it('should clear currentTool after debounce on tool_complete', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const startEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Edit',
        tool_use_id: 'tool-clear-123',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(startEvent);
      });

      expect(result.current.currentTool).toEqual(startEvent);

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Edit',
        tool_use_id: 'tool-clear-123',
        parent_agent_id: null,
        success: true,
        duration_ms: 500,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      act(() => {
        toolEventHandler(completeEvent);
      });

      // Still set due to debounce
      expect(result.current.currentTool).toEqual(startEvent);

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(result.current.currentTool).toBeNull();
    });

    it('should handle error in tool_complete', () => {
      toolLogRef.current = [{
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-error-123',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      }];

      renderHook(() => useToolEvents(mockProps));

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Bash',
        tool_use_id: 'tool-error-123',
        parent_agent_id: null,
        success: false,
        error: 'Command failed',
        duration_ms: 1000,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(completeEvent);
      });

      expect(toolLogRef.current[0]).toMatchObject({
        success: false,
        error: 'Command failed',
      });
    });

    it('should filter out "Worker restarted" error', () => {
      toolLogRef.current = [{
        type: 'tool_start',
        tool_name: 'Agent',
        tool_use_id: 'tool-restart-123',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      }];

      renderHook(() => useToolEvents(mockProps));

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Agent',
        tool_use_id: 'tool-restart-123',
        parent_agent_id: null,
        success: false,
        error: 'Worker restarted',
        duration_ms: 1000,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(completeEvent);
      });

      expect(toolLogRef.current[0].error).toBeUndefined();
    });
  });

  describe('Agent events - agent_start', () => {
    it('should process agent_start event', () => {
      renderHook(() => useToolEvents(mockProps));

      const agentEvent: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'agent-123',
        parent_agent_id: null,
        agent_type: 'code_agent',
        description: 'Write tests',
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(agentEvent);
      });

      expect(mockProps.dispatchTree).toHaveBeenCalledWith({
        type: 'AGENT_START',
        event: agentEvent,
        sequence: 1,
      });
      expect(mockProps.setStreaming).toHaveBeenCalledWith(true);
      expect(toolLogRef.current).toHaveLength(1);
    });

    it('should finalize streaming message on agent_start', () => {
      mockProps.streamingIdRef.current = 'stream-msg-456';
      mockProps.streamingContentRef.current = 'Content here';

      renderHook(() => useToolEvents(mockProps));

      const agentEvent: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'agent-456',
        parent_agent_id: null,
        agent_type: 'tdd-guide',
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(agentEvent);
      });

      expect(mockProps.setMessages).toHaveBeenCalled();
      expect(mockProps.streamingIdRef.current).toBeNull();
    });
  });

  describe('Agent events - agent_stop', () => {
    it('should process agent_stop event', () => {
      toolLogRef.current = [{
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'agent-stop-123',
        parent_agent_id: null,
        agent_type: 'code_agent',
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      }];

      renderHook(() => useToolEvents(mockProps));

      const stopEvent: ToolEvent = {
        type: 'agent_stop',
        tool_name: 'Agent',
        tool_use_id: 'agent-stop-123',
        parent_agent_id: null,
        success: true,
        duration_ms: 5000,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(stopEvent);
      });

      expect(mockProps.dispatchTree).toHaveBeenCalledWith({
        type: 'AGENT_STOP',
        event: stopEvent,
      });

      expect(toolLogRef.current[0]).toMatchObject({
        type: 'agent_stop',
        success: true,
        duration_ms: 5000,
      });
    });

    it('should filter out "Worker restarted" error on agent_stop', () => {
      toolLogRef.current = [{
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'agent-restart-456',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      }];

      renderHook(() => useToolEvents(mockProps));

      const stopEvent: ToolEvent = {
        type: 'agent_stop',
        tool_name: 'Agent',
        tool_use_id: 'agent-restart-456',
        parent_agent_id: null,
        success: false,
        error: 'Worker restarted',
        duration_ms: 2000,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(stopEvent);
      });

      expect(toolLogRef.current[0].error).toBeUndefined();
    });
  });

  describe('Debounced current tool setting', () => {
    it('should set currentTool immediately when not null', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const toolEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Write',
        tool_use_id: 'tool-debounce-123',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(toolEvent);
      });

      expect(result.current.currentTool).toEqual(toolEvent);
    });

    it('should debounce clearing currentTool', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const startEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Grep',
        tool_use_id: 'tool-debounce-456',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(startEvent);
      });

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Grep',
        tool_use_id: 'tool-debounce-456',
        parent_agent_id: null,
        success: true,
        duration_ms: 100,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      act(() => {
        toolEventHandler(completeEvent);
      });

      // Still set before timeout
      expect(result.current.currentTool).toEqual(startEvent);

      act(() => {
        jest.advanceTimersByTime(150);
      });

      // Still set (300ms debounce)
      expect(result.current.currentTool).toEqual(startEvent);

      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Now cleared
      expect(result.current.currentTool).toBeNull();
    });

    it('should cancel pending clear if new tool starts', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const firstEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool-first',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(firstEvent);
      });

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Read',
        tool_use_id: 'tool-first',
        parent_agent_id: null,
        success: true,
        duration_ms: 50,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      act(() => {
        toolEventHandler(completeEvent);
      });

      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Start new tool before debounce completes
      const secondEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Write',
        tool_use_id: 'tool-second',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      act(() => {
        toolEventHandler(secondEvent);
      });

      expect(result.current.currentTool).toEqual(secondEvent);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should still be second event, not cleared
      expect(result.current.currentTool).toEqual(secondEvent);
    });
  });

  describe('Signal handling', () => {
    it('should handle status signal', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const signalHandler = mockOn.mock.calls.find(call => call[0] === 'signal')?.[1];
      act(() => {
        signalHandler({
          type: 'status',
          data: { phase: 'thinking', detail: 'Processing request' },
        });
      });

      expect(result.current.signals.status).toEqual({
        phase: 'thinking',
        detail: 'Processing request',
      });
    });

    it('should handle status signal without detail', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const signalHandler = mockOn.mock.calls.find(call => call[0] === 'signal')?.[1];
      act(() => {
        signalHandler({
          type: 'status',
          data: { phase: 'working' },
        });
      });

      expect(result.current.signals.status).toEqual({
        phase: 'working',
        detail: undefined,
      });
    });
  });

  describe('User question handling', () => {
    it('should set pending question', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const questionData = {
        questions: [
          {
            question: 'Select an option',
            header: 'User Input',
            options: [
              { label: 'Option 1', description: 'First option' },
              { label: 'Option 2', description: 'Second option' },
            ],
            multiSelect: false,
          },
        ],
        tool_use_id: 'tool-question-123',
      };

      const questionHandler = mockOn.mock.calls.find(call => call[0] === 'user_question')?.[1];
      act(() => {
        questionHandler(questionData);
      });

      expect(result.current.pendingQuestion).toEqual({
        questions: questionData.questions,
        toolUseId: 'tool-question-123',
      });
    });
  });

  describe('Tool progress handling', () => {
    it('should dispatch tool progress', () => {
      renderHook(() => useToolEvents(mockProps));

      const progressData = {
        tool_use_id: 'tool-progress-123',
        elapsed_seconds: 15,
      };

      const progressHandler = mockOn.mock.calls.find(call => call[0] === 'tool_progress')?.[1];
      act(() => {
        progressHandler(progressData);
      });

      expect(mockProps.dispatchTree).toHaveBeenCalledWith({
        type: 'TOOL_PROGRESS',
        toolUseId: 'tool-progress-123',
        elapsedSeconds: 15,
      });
    });
  });

  describe('Rate limit handling', () => {
    it('should set rate limit state', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const rateLimitData = {
        retryAfterMs: 5000,
        rateLimitedAt: new Date().toISOString(),
      };

      const rateLimitHandler = mockOn.mock.calls.find(call => call[0] === 'rate_limit')?.[1];
      act(() => {
        rateLimitHandler(rateLimitData);
      });

      expect(result.current.rateLimitState).toEqual({
        active: true,
        retryAfterMs: 5000,
      });
    });

    it('should clear rate limit after timeout', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const rateLimitData = {
        retryAfterMs: 3000,
        rateLimitedAt: new Date().toISOString(),
      };

      const rateLimitHandler = mockOn.mock.calls.find(call => call[0] === 'rate_limit')?.[1];
      act(() => {
        rateLimitHandler(rateLimitData);
      });

      expect(result.current.rateLimitState).not.toBeNull();

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(result.current.rateLimitState).toBeNull();
    });
  });

  describe('Prompt suggestions handling', () => {
    it('should set prompt suggestions', () => {
      const { result } = renderHook(() => useToolEvents(mockProps));

      const suggestions = ['Test this feature', 'Fix the bug', 'Add documentation'];

      const suggestionsHandler = mockOn.mock.calls.find(call => call[0] === 'prompt_suggestions')?.[1];
      act(() => {
        suggestionsHandler({ suggestions });
      });

      expect(result.current.promptSuggestions).toEqual(suggestions);
    });
  });

  describe('Cleanup', () => {
    it('should clear debounce timer on unmount', () => {
      const { result, unmount } = renderHook(() => useToolEvents(mockProps));

      const startEvent: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool-cleanup',
        parent_agent_id: null,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      const toolEventHandler = mockOn.mock.calls.find(call => call[0] === 'tool_event')?.[1];
      act(() => {
        toolEventHandler(startEvent);
      });

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Bash',
        tool_use_id: 'tool-cleanup',
        parent_agent_id: null,
        success: true,
        duration_ms: 100,
        timestamp: new Date().toISOString(),
        session_id: 'test-session-123',
      };

      act(() => {
        toolEventHandler(completeEvent);
      });

      unmount();

      // Timer should be cleared, so advancing time shouldn't affect anything
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // No error should occur
    });
  });
});
