import { renderHook, act } from '@testing-library/react';
import { useSessionActions } from './useSessionActions';
import { Socket } from 'socket.io-client';
import { Message, ToolEvent } from '../types';
import { TreeAction } from './useActivityTree';

describe('useSessionActions', () => {
  let mockSocket: jest.Mocked<Socket>;
  let mockProps: {
    socket: Socket | null;
    connected: boolean;
    currentSessionIdRef: { current: string };
    backgroundProcessing: boolean;
    streamingIdRef: { current: string | null };
    streamingContentRef: { current: string };
    responseCompleteRef: { current: boolean };
    completionFinalizedRef: { current: boolean };
    messageIndexRef: { current: number };
    setMessages: jest.Mock;
    setStreaming: jest.Mock;
    setBackgroundProcessing: jest.Mock;
    setThinking: jest.Mock;
    setCurrentTool: jest.Mock;
    setPendingQuestion: jest.Mock;
    setPromptSuggestions: jest.Mock;
    setSignals: jest.Mock;
    toolLogRef: { current: ToolEvent[] };
    setToolLog: jest.Mock;
    dispatchTree: jest.Mock<void, [TreeAction]>;
    clearToolTimerRef: { current: ReturnType<typeof setTimeout> | null };
  };

  beforeEach(() => {
    mockSocket = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      connected: true,
    } as unknown as jest.Mocked<Socket>;

    mockProps = {
      socket: mockSocket,
      connected: true,
      currentSessionIdRef: { current: 'session-123' },
      backgroundProcessing: false,
      streamingIdRef: { current: null },
      streamingContentRef: { current: '' },
      responseCompleteRef: { current: false },
      completionFinalizedRef: { current: false },
      messageIndexRef: { current: 0 },
      setMessages: jest.fn(),
      setStreaming: jest.fn(),
      setBackgroundProcessing: jest.fn(),
      setThinking: jest.fn(),
      setCurrentTool: jest.fn(),
      setPendingQuestion: jest.fn(),
      setPromptSuggestions: jest.fn(),
      setSignals: jest.fn(),
      toolLogRef: { current: [] },
      setToolLog: jest.fn(),
      dispatchTree: jest.fn(),
      clearToolTimerRef: { current: null },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should emit message event with correct session_id', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'message',
        expect.objectContaining({
          content: 'Hello',
          session_id: 'session-123',
        })
      );
    });

    it('should emit message with workspace and model', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello', '/workspace/path', 'claude-sonnet-4.5');
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'message',
        expect.objectContaining({
          content: 'Hello',
          workspace: '/workspace/path',
          model: 'claude-sonnet-4.5',
          session_id: 'session-123',
        })
      );
    });

    it('should emit message with image_ids', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Check these images', undefined, undefined, ['img1', 'img2']);
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'message',
        expect.objectContaining({
          content: 'Check these images',
          image_ids: ['img1', 'img2'],
          session_id: 'session-123',
        })
      );
    });

    it('should not send if socket is null', () => {
      const propsWithoutSocket = { ...mockProps, socket: null };
      const { result } = renderHook(() => useSessionActions(propsWithoutSocket));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should not send if not connected', () => {
      const propsDisconnected = { ...mockProps, connected: false };
      const { result } = renderHook(() => useSessionActions(propsDisconnected));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should reset streaming state on send', () => {
      mockProps.streamingIdRef.current = 'streaming-msg-id';
      mockProps.streamingContentRef.current = 'Partial content';

      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('New message');
      });

      expect(mockProps.streamingIdRef.current).toBeNull();
      expect(mockProps.streamingContentRef.current).toBe('');
      expect(mockProps.responseCompleteRef.current).toBe(false);
      expect(mockProps.completionFinalizedRef.current).toBe(false);
      expect(mockProps.messageIndexRef.current).toBe(0);
      expect(mockProps.setThinking).toHaveBeenCalledWith('');
    });

    it('should finalize streaming message before sending new one', () => {
      mockProps.streamingIdRef.current = 'streaming-msg-id';
      mockProps.streamingContentRef.current = 'Final content';

      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('New message');
      });

      expect(mockProps.setMessages).toHaveBeenCalledWith(expect.any(Function));
      const updater = mockProps.setMessages.mock.calls[0][0];
      const prevMessages: Message[] = [
        { id: 'streaming-msg-id', content: 'Partial', role: 'assistant', timestamp: Date.now(), streaming: true },
      ];
      const updated = updater(prevMessages);
      expect(updated[0].content).toBe('Final content');
      expect(updated[0].streaming).toBe(false);
    });

    it('should add user message to messages', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('User question');
      });

      expect(mockProps.setMessages).toHaveBeenCalledWith(expect.any(Function));
      const updater = mockProps.setMessages.mock.calls[mockProps.setMessages.mock.calls.length - 1][0];
      const updated = updater([]);
      expect(updated).toHaveLength(1);
      expect(updated[0].role).toBe('user');
      expect(updated[0].content).toBe('User question');
    });

    it('should set streaming to true', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockProps.setStreaming).toHaveBeenCalledWith(true);
    });

    it('should clear tool log', () => {
      mockProps.toolLogRef.current = [
        { type: 'tool_start', tool_name: 'Bash', tool_use_id: 'tool-1', parent_agent_id: null, timestamp: '2025-01-01T00:00:00Z' },
      ];

      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockProps.toolLogRef.current).toEqual([]);
      expect(mockProps.setToolLog).toHaveBeenCalledWith([]);
    });

    it('should clear signals', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockProps.setSignals).toHaveBeenCalledWith({ status: null });
    });

    it('should clear prompt suggestions', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockProps.setPromptSuggestions).toHaveBeenCalledWith([]);
    });

    it('should cancel background processing before sending', () => {
      const propsWithBackground = { ...mockProps, backgroundProcessing: true };
      const { result } = renderHook(() => useSessionActions(propsWithBackground));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('cancel', { session_id: 'session-123' });
      expect(mockProps.setBackgroundProcessing).toHaveBeenCalledWith(false);
      expect(mockProps.dispatchTree).toHaveBeenCalledWith({ type: 'MARK_ALL_STOPPED' });
    });
  });

  describe('cancelQuery', () => {
    it('should emit cancel event with session_id', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('cancel', { session_id: 'session-123' });
    });

    it('should not cancel if socket is null', () => {
      const propsWithoutSocket = { ...mockProps, socket: null };
      const { result } = renderHook(() => useSessionActions(propsWithoutSocket));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should not cancel if not connected', () => {
      const propsDisconnected = { ...mockProps, connected: false };
      const { result } = renderHook(() => useSessionActions(propsDisconnected));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should mark all tree nodes as stopped', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.dispatchTree).toHaveBeenCalledWith({ type: 'MARK_ALL_STOPPED' });
    });

    it('should finalize streaming message', () => {
      mockProps.streamingIdRef.current = 'msg-123';

      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.setMessages).toHaveBeenCalledWith(expect.any(Function));
      const updater = mockProps.setMessages.mock.calls[0][0];
      const prevMessages: Message[] = [
        { id: 'msg-123', content: 'Content', role: 'assistant', timestamp: Date.now(), streaming: true },
      ];
      const updated = updater(prevMessages);
      expect(updated[0].streaming).toBe(false);
    });

    it('should reset streaming refs', () => {
      mockProps.streamingIdRef.current = 'msg-123';
      mockProps.streamingContentRef.current = 'Content';
      mockProps.responseCompleteRef.current = true;
      mockProps.completionFinalizedRef.current = true;

      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.streamingIdRef.current).toBeNull();
      expect(mockProps.streamingContentRef.current).toBe('');
      expect(mockProps.responseCompleteRef.current).toBe(false);
      expect(mockProps.completionFinalizedRef.current).toBe(false);
    });

    it('should set streaming to false', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.setStreaming).toHaveBeenCalledWith(false);
      expect(mockProps.setBackgroundProcessing).toHaveBeenCalledWith(false);
    });

    it('should clear current tool and pending question', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.setCurrentTool).toHaveBeenCalledWith(null);
      expect(mockProps.setPendingQuestion).toHaveBeenCalledWith(null);
    });

    it('should clear signals', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.setSignals).toHaveBeenCalledWith({ status: null });
    });

    it('should clear tool timer', () => {
      const mockTimer = setTimeout(() => {}, 1000);
      mockProps.clearToolTimerRef.current = mockTimer;

      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.clearToolTimerRef.current).toBeNull();
    });
  });

  describe('respondToQuestion', () => {
    it('should emit question_response with session_id', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      const response = { answer: 'yes' };

      act(() => {
        result.current.respondToQuestion(response);
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('question_response', {
        response,
        session_id: 'session-123',
      });
    });

    it('should not respond if socket is null', () => {
      const propsWithoutSocket = { ...mockProps, socket: null };
      const { result } = renderHook(() => useSessionActions(propsWithoutSocket));

      act(() => {
        result.current.respondToQuestion({ answer: 'yes' });
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should not respond if not connected', () => {
      const propsDisconnected = { ...mockProps, connected: false };
      const { result } = renderHook(() => useSessionActions(propsDisconnected));

      act(() => {
        result.current.respondToQuestion({ answer: 'yes' });
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should clear pending question', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.respondToQuestion({ answer: 'yes' });
      });

      expect(mockProps.setPendingQuestion).toHaveBeenCalledWith(null);
    });
  });

  describe('duplicateSession', () => {
    it('should emit duplicate_session event', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.duplicateSession('source-session-id', 'new-session-id');
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('duplicate_session', {
        sourceSessionId: 'source-session-id',
        newSessionId: 'new-session-id',
      });
    });

    it('should not duplicate if socket is null', () => {
      const propsWithoutSocket = { ...mockProps, socket: null };
      const { result } = renderHook(() => useSessionActions(propsWithoutSocket));

      act(() => {
        result.current.duplicateSession('source-id', 'new-id');
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should not duplicate if not connected', () => {
      const propsDisconnected = { ...mockProps, connected: false };
      const { result } = renderHook(() => useSessionActions(propsDisconnected));

      act(() => {
        result.current.duplicateSession('source-id', 'new-id');
      });

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });
});
