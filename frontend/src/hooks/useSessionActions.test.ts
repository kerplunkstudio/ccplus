import { renderHook, act } from '@testing-library/react';
import { useSessionActions } from './useSessionActions';
import { Socket } from 'socket.io-client';
import { ToolEvent } from '../types';
import { TreeAction } from './useActivityTree';
import { StreamAction } from './streamReducer';

describe('useSessionActions', () => {
  let mockSocket: jest.Mocked<Socket>;
  let mockProps: {
    socket: Socket | null;
    connected: boolean;
    currentSessionIdRef: { current: string };
    backgroundProcessing: boolean;
    streamDispatch: jest.Mock<void, [StreamAction]>;
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
      streamDispatch: jest.fn(),
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

    it('should NOT dispatch CANCEL_QUERY (allows mid-stream injection)', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('New message');
      });

      expect(mockProps.streamDispatch).not.toHaveBeenCalledWith({ type: 'CANCEL_QUERY' });
    });

    it('should dispatch SEND_MESSAGE with user message', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('User question');
      });

      expect(mockProps.streamDispatch).toHaveBeenCalledWith({
        type: 'SEND_MESSAGE',
        message: expect.objectContaining({
          role: 'user',
          content: 'User question',
        }),
      });
    });

    it('should NOT clear tool log (preserves state during injection)', () => {
      mockProps.toolLogRef.current = [
        { type: 'tool_start', tool_name: 'Bash', tool_use_id: 'tool-1', parent_agent_id: null, timestamp: '2025-01-01T00:00:00Z' },
      ];

      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockProps.toolLogRef.current).not.toEqual([]);
      expect(mockProps.setToolLog).not.toHaveBeenCalled();
    });

    it('should NOT clear signals (preserves state during injection)', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.sendMessage('Hello');
      });

      expect(mockProps.setSignals).not.toHaveBeenCalled();
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
      expect(mockProps.streamDispatch).toHaveBeenCalledWith({ type: 'SET_BACKGROUND_PROCESSING', value: false });
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

    it('should dispatch CANCEL_QUERY', () => {
      const { result } = renderHook(() => useSessionActions(mockProps));

      act(() => {
        result.current.cancelQuery();
      });

      expect(mockProps.streamDispatch).toHaveBeenCalledWith({ type: 'CANCEL_QUERY' });
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
