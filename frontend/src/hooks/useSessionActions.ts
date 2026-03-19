import { useCallback, MutableRefObject, Dispatch } from 'react';
import { Socket } from 'socket.io-client';
import { Message, ToolEvent, PendingQuestion, SignalState, ImageAttachment } from '../types';
import { TreeAction } from './useActivityTree';
import { StreamAction } from './streamReducer';

interface UseSessionActionsProps {
  socket: Socket | null;
  connected: boolean;
  currentSessionIdRef: MutableRefObject<string>;
  backgroundProcessing: boolean;
  streamDispatch: Dispatch<StreamAction>;
  setCurrentTool: (tool: ToolEvent | null) => void;
  setPendingQuestion: (question: PendingQuestion | null) => void;
  setPromptSuggestions: (suggestions: string[]) => void;
  setSignals: (signals: SignalState) => void;
  toolLogRef: MutableRefObject<ToolEvent[]>;
  setToolLog: Dispatch<React.SetStateAction<ToolEvent[]>>;
  dispatchTree: Dispatch<TreeAction>;
  clearToolTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useSessionActions({
  socket,
  connected,
  currentSessionIdRef,
  backgroundProcessing,
  streamDispatch,
  setCurrentTool,
  setPendingQuestion,
  setPromptSuggestions,
  setSignals,
  toolLogRef,
  setToolLog,
  dispatchTree,
  clearToolTimerRef,
}: UseSessionActionsProps) {
  const sendMessage = useCallback(
    (content: string, workspace?: string, model?: string, imageIds?: string[], images?: ImageAttachment[]) => {
      if (!socket || !connected) return;

      setPromptSuggestions([]);

      if (backgroundProcessing) {
        socket.emit('cancel', { session_id: currentSessionIdRef.current });
        streamDispatch({ type: 'SET_BACKGROUND_PROCESSING', value: false });
        dispatchTree({ type: 'MARK_ALL_STOPPED' });
      }

      // Cancel any existing query and finalize streaming
      streamDispatch({ type: 'CANCEL_QUERY' });

      const userMessage: Message = {
        id: `user_${Date.now()}`,
        content,
        role: 'user',
        timestamp: Date.now(),
        images: images || [],
      };
      streamDispatch({ type: 'SEND_MESSAGE', message: userMessage });
      toolLogRef.current = [];
      setToolLog([]);
      setSignals({ status: null });
      socket.emit('message', { content, workspace, model, image_ids: imageIds, session_id: currentSessionIdRef.current });
    },
    [socket, connected, backgroundProcessing, currentSessionIdRef, streamDispatch, toolLogRef, setToolLog, setSignals, dispatchTree, setPromptSuggestions]
  );

  const cancelQuery = useCallback(() => {
    if (!socket || !connected) return;
    socket.emit('cancel', { session_id: currentSessionIdRef.current });

    dispatchTree({ type: 'MARK_ALL_STOPPED' });
    streamDispatch({ type: 'CANCEL_QUERY' });

    if (clearToolTimerRef.current) {
      clearTimeout(clearToolTimerRef.current);
      clearToolTimerRef.current = null;
    }
    setCurrentTool(null);
    setPendingQuestion(null);
    setSignals({ status: null });
  }, [socket, connected, currentSessionIdRef, streamDispatch, clearToolTimerRef, setCurrentTool, setPendingQuestion, setSignals, dispatchTree]);

  const respondToQuestion = useCallback(
    (response: Record<string, string>) => {
      if (!socket || !connected) return;
      socket.emit('question_response', { response, session_id: currentSessionIdRef.current });
      setPendingQuestion(null);
    },
    [socket, connected, currentSessionIdRef, setPendingQuestion]
  );

  const duplicateSession = useCallback(
    (sourceSessionId: string, newSessionId: string) => {
      if (!socket || !connected) return;
      socket.emit('duplicate_session', { sourceSessionId, newSessionId });
    },
    [socket, connected]
  );

  return {
    sendMessage,
    cancelQuery,
    respondToQuestion,
    duplicateSession,
  };
}
