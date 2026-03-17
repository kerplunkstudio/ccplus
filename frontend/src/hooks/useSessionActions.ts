import { useCallback, MutableRefObject, Dispatch } from 'react';
import { Socket } from 'socket.io-client';
import { Message, ToolEvent, PendingQuestion, SignalState } from '../types';
import { TreeAction } from './useActivityTree';

interface UseSessionActionsProps {
  socket: Socket | null;
  connected: boolean;
  currentSessionIdRef: MutableRefObject<string>;
  backgroundProcessing: boolean;
  streamingIdRef: MutableRefObject<string | null>;
  streamingContentRef: MutableRefObject<string>;
  responseCompleteRef: MutableRefObject<boolean>;
  completionFinalizedRef: MutableRefObject<boolean>;
  messageIndexRef: MutableRefObject<number>;
  setMessages: Dispatch<React.SetStateAction<Message[]>>;
  setStreaming: (streaming: boolean) => void;
  setBackgroundProcessing: (processing: boolean) => void;
  setThinking: (thinking: string) => void;
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
  streamingIdRef,
  streamingContentRef,
  responseCompleteRef,
  completionFinalizedRef,
  messageIndexRef,
  setMessages,
  setStreaming,
  setBackgroundProcessing,
  setThinking,
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
    (content: string, workspace?: string, model?: string, imageIds?: string[]) => {
      if (!socket || !connected) return;

      setPromptSuggestions([]);

      if (backgroundProcessing) {
        socket.emit('cancel', { session_id: currentSessionIdRef.current });
        setBackgroundProcessing(false);
        dispatchTree({ type: 'MARK_ALL_STOPPED' });
      }

      const currentStreamingId = streamingIdRef.current;
      if (currentStreamingId) {
        const finalContent = streamingContentRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentStreamingId ? { ...m, content: finalContent, streaming: false } : m
          )
        );
        streamingContentRef.current = '';
        streamingIdRef.current = null;
        responseCompleteRef.current = false;
        completionFinalizedRef.current = false;
        messageIndexRef.current = 0;
        setThinking('');
      }

      const userMessage: Message = {
        id: `user_${Date.now()}`,
        content,
        role: 'user',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setStreaming(true);
      toolLogRef.current = [];
      setToolLog([]);
      setSignals({ status: null });
      socket.emit('message', { content, workspace, model, image_ids: imageIds, session_id: currentSessionIdRef.current });
    },
    [socket, connected, backgroundProcessing, currentSessionIdRef, streamingIdRef, streamingContentRef, responseCompleteRef, completionFinalizedRef, messageIndexRef, setMessages, setStreaming, setBackgroundProcessing, setThinking, toolLogRef, setToolLog, setSignals, dispatchTree, setPromptSuggestions]
  );

  const cancelQuery = useCallback(() => {
    if (!socket || !connected) return;
    socket.emit('cancel', { session_id: currentSessionIdRef.current });

    dispatchTree({ type: 'MARK_ALL_STOPPED' });

    const msgId = streamingIdRef.current;
    if (msgId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, streaming: false } : m
        )
      );
    }
    streamingContentRef.current = '';
    streamingIdRef.current = null;
    responseCompleteRef.current = false;
    completionFinalizedRef.current = false;
    setStreaming(false);
    setBackgroundProcessing(false);
    if (clearToolTimerRef.current) {
      clearTimeout(clearToolTimerRef.current);
      clearToolTimerRef.current = null;
    }
    setCurrentTool(null);
    setPendingQuestion(null);
    setSignals({ status: null });
  }, [socket, connected, currentSessionIdRef, streamingIdRef, streamingContentRef, responseCompleteRef, completionFinalizedRef, setMessages, setStreaming, setBackgroundProcessing, clearToolTimerRef, setCurrentTool, setPendingQuestion, setSignals, dispatchTree]);

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
