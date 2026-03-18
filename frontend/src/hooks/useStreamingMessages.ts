import { useState, useEffect, useRef, useCallback, MutableRefObject, Dispatch } from 'react';
import { Socket } from 'socket.io-client';
import { Message, UsageStats, ToolEvent, ActivityNode } from '../types';
import { TreeAction } from './useActivityTree';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-6': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
  'sonnet': 1_000_000,
  'opus': 1_000_000,
  'haiku': 200_000,
};
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

export const fetchUserStats = async (): Promise<UsageStats> => {
  try {
    const res = await fetch(`${SOCKET_URL}/api/stats/user`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    const data = await res.json();
    return {
      totalCost: data.total_cost || 0,
      totalInputTokens: data.total_input_tokens || 0,
      totalOutputTokens: data.total_output_tokens || 0,
      totalDuration: data.total_duration_ms || 0,
      queryCount: data.total_queries || 0,
      contextWindowSize: DEFAULT_CONTEXT_WINDOW,
      model: '',
      linesOfCode: data.total_lines_of_code || 0,
      totalSessions: data.total_sessions || 0,
    };
  } catch {
    return {
      totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
      totalDuration: 0, queryCount: 0, contextWindowSize: DEFAULT_CONTEXT_WINDOW,
      model: '', linesOfCode: 0, totalSessions: 0,
    };
  }
};

interface UseStreamingMessagesProps {
  socket: Socket | null;
  toolLogRef: MutableRefObject<ToolEvent[]>;
  activityTreeRef: MutableRefObject<ActivityNode[]>;
  hasRunningAgents: (nodes: ActivityNode[]) => boolean;
  isRestoringSessionRef: MutableRefObject<boolean>;
  currentSessionIdRef: MutableRefObject<string>;
  sessionId: string;
}

export function useStreamingMessages({
  socket,
  toolLogRef,
  activityTreeRef,
  hasRunningAgents,
  isRestoringSessionRef,
  currentSessionIdRef,
  sessionId,
}: UseStreamingMessagesProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const [thinking, setThinking] = useState<string>('');
  const [usageStats, setUsageStats] = useState<UsageStats>({
    totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
    totalDuration: 0, queryCount: 0, contextWindowSize: DEFAULT_CONTEXT_WINDOW,
    model: '', linesOfCode: 0, totalSessions: 0,
  });
  const [contextTokens, setContextTokens] = useState<number | null>(null);
  const [pendingRestore, setPendingRestore] = useState(false);

  // Refs for streaming state
  const streamingContentRef = useRef('');
  const streamingIdRef = useRef<string | null>(null);
  const responseCompleteRef = useRef(false);
  const messageIndexRef = useRef<number>(0);
  const completionFinalizedRef = useRef(false);
  const syncInProgressRef = useRef(false);
  const streamActiveRef = useRef(false);
  const awaitingDeltaAfterRestore = useRef(false);
  const intermediateCompletionRef = useRef(false);

  // Refs to mirror state for session cache saves (avoid stale closures)
  const streamingRef = useRef(false);
  const backgroundProcessingRef = useRef(false);
  const thinkingRef = useRef('');
  const messagesRef = useRef<Message[]>([]);

  // Sync refs with state
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { backgroundProcessingRef.current = backgroundProcessing; }, [backgroundProcessing]);
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Fetch persisted stats from backend on mount
  useEffect(() => {
    fetchUserStats().then(setUsageStats);
  }, []);

  // Safety cleanup: Clear backgroundProcessing if no agents are running
  useEffect(() => {
    if (!backgroundProcessing || streaming) return;

    const cleanupTimer = setTimeout(() => {
      const hasRunning = hasRunningAgents(activityTreeRef.current);
      if (!hasRunning && backgroundProcessing) {
        setBackgroundProcessing(false);
        toolLogRef.current = [];
      }
    }, 500);

    return () => clearTimeout(cleanupTimer);
  }, [backgroundProcessing, streaming, activityTreeRef, hasRunningAgents, toolLogRef]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('message_received', () => {
      window.dispatchEvent(new CustomEvent('ccplus_message_received'));
    });

    socket.on('stream_active', (data?: { session_id?: string }) => {
      if (data?.session_id && data.session_id !== currentSessionIdRef.current) return;
      streamActiveRef.current = true;
      setStreaming(true);
    });

    socket.on('stream_content_sync', (data: { content: string; session_id?: string }) => {
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;

      syncInProgressRef.current = true;
      streamingContentRef.current = data.content;

      // During session restore, just buffer content — don't create messages
      // The restore will set up the proper message structure
      if (isRestoringSessionRef.current) {
        syncInProgressRef.current = false;
        return;
      }

      if (!streamingIdRef.current) {
        const msgId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        streamingIdRef.current = msgId;
        setStreaming(true);
        setMessages((prev) => {
          const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.streaming) {
            streamingIdRef.current = lastMsg.id;
            return prev.map((m) =>
              m.id === lastMsg.id ? { ...m, content: data.content } : m
            );
          }
          return [
            ...prev,
            {
              id: msgId,
              content: data.content,
              role: 'assistant' as const,
              timestamp: Date.now(),
              streaming: true,
            },
          ];
        });
      } else {
        const msgId = streamingIdRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: data.content } : m
          )
        );
      }

      syncInProgressRef.current = false;

      if (awaitingDeltaAfterRestore.current) {
        awaitingDeltaAfterRestore.current = false;
        setPendingRestore(false);
      }
    });

    socket.on('thinking_delta', (data: { text: string }) => {
      setThinking(prev => prev + data.text);
    });

    socket.on('text_delta', (data: { text: string; message_id?: string; message_index?: number; session_id?: string }) => {
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;
      if (syncInProgressRef.current) return;

      // During session restore, buffer content but don't create messages
      if (isRestoringSessionRef.current && !streamingIdRef.current) {
        streamingContentRef.current += data.text;
        return;
      }

      if (awaitingDeltaAfterRestore.current) {
        awaitingDeltaAfterRestore.current = false;
        setPendingRestore(false);
      }

      setStreaming(true);
      setBackgroundProcessing(false);

      const incomingIndex = data.message_index ?? 0;

      if (incomingIndex > 0 && incomingIndex !== messageIndexRef.current && streamingIdRef.current) {
        const oldMsgId = streamingIdRef.current;
        const oldContent = streamingContentRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === oldMsgId ? { ...m, content: oldContent, streaming: false } : m
          )
        );
        streamingIdRef.current = null;
        streamingContentRef.current = '';
        responseCompleteRef.current = false;
      }
      messageIndexRef.current = incomingIndex;

      if (!streamingIdRef.current) {
        setMessages((prev) => {
          const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.streaming && !intermediateCompletionRef.current) {
            streamingIdRef.current = lastMsg.id;
            streamingContentRef.current = lastMsg.content + data.text;
            const updatedContent = streamingContentRef.current;
            return prev.map((m) =>
              m.id === lastMsg.id ? { ...m, content: updatedContent } : m
            );
          } else {
            const msgId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
            streamingContentRef.current = data.text;
            streamingIdRef.current = msgId;
            setThinking('');
            intermediateCompletionRef.current = false;
            return [
              ...prev,
              {
                id: msgId,
                content: data.text,
                role: 'assistant' as const,
                timestamp: Date.now(),
                streaming: true,
              },
            ];
          }
        });
      } else {
        streamingContentRef.current += data.text;
        const currentContent = streamingContentRef.current;
        const msgId = streamingIdRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: currentContent } : m
          )
        );
      }
    });

    socket.on('response_complete', (data: {
      message_id?: string;
      content?: string;
      cost?: number;
      duration_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      model?: string;
      sdk_session_id?: string | null;
      session_id?: string;
      context_window_size?: number;
    }) => {
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;

      const msgId = streamingIdRef.current;
      const alreadyFinalized = completionFinalizedRef.current;
      const isFinalCompletion = data.sdk_session_id !== null && data.sdk_session_id !== undefined;

      if (msgId) {
        const finalContent = streamingContentRef.current || data.content || '';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: finalContent, streaming: false, toolLog: [...toolLogRef.current] } : m
          )
        );

        completionFinalizedRef.current = true;

        if (isFinalCompletion) {
          // Only clear refs on final completion
          responseCompleteRef.current = true;
          streamingContentRef.current = '';
          setTimeout(() => {
            responseCompleteRef.current = false;
            streamingIdRef.current = null;
          }, 100);
        }
        // For intermediate completions: keep streamingIdRef and streamingContentRef intact
        // so subsequent text_deltas update the same message instead of creating duplicates
      }

      if (data.input_tokens != null && data.input_tokens > 0) {
        setContextTokens(data.input_tokens);
      }

      // Update context window size - try backend value, then model lookup, then default
      const windowSize = (data.context_window_size && data.context_window_size > 0)
        ? data.context_window_size
        : data.model
          ? (MODEL_CONTEXT_WINDOWS[data.model] || DEFAULT_CONTEXT_WINDOW)
          : null;
      if (windowSize || data.model) {
        setUsageStats(prev => ({
          ...prev,
          contextWindowSize: windowSize || prev.contextWindowSize,
          model: data.model || prev.model,
        }));
      }

      if (isFinalCompletion) {
        fetchUserStats().then(stats => {
          setUsageStats(prev => ({
            ...stats,
            contextWindowSize: prev.contextWindowSize,
            model: prev.model || stats.model,
          }));
        });

        setStreaming(false);
        setBackgroundProcessing(false);
        setThinking('');
        awaitingDeltaAfterRestore.current = false;
        setPendingRestore(false);
        toolLogRef.current = [];
        completionFinalizedRef.current = false;
        messageIndexRef.current = 0;
        streamingIdRef.current = null;
        responseCompleteRef.current = false;
        streamingContentRef.current = '';
        intermediateCompletionRef.current = false;
      } else {
        intermediateCompletionRef.current = true;
        streamingIdRef.current = null;
        streamingContentRef.current = '';
        completionFinalizedRef.current = false;

        setStreaming(false);

        setTimeout(() => {
          const hasRunning = hasRunningAgents(activityTreeRef.current);
          if (hasRunning) {
            setBackgroundProcessing(true);
          } else {
            setTimeout(() => {
              toolLogRef.current = [];
            }, 1000);
          }
        }, 100);
      }

      if (!msgId && data.content && !alreadyFinalized && !isRestoringSessionRef.current) {
        const recoveryId = `recovery_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        setMessages((prev) => {
          const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === data.content) {
            return prev;
          }
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.streaming) {
            return prev.map((m) =>
              m.id === lastMsg.id ? { ...m, content: data.content, streaming: false } : m
            );
          }
          return [
            ...prev,
            {
              id: recoveryId,
              content: data.content,
              role: 'assistant' as const,
              timestamp: Date.now(),
              streaming: false,
            },
          ];
        });
        completionFinalizedRef.current = true;
      }
    });

    socket.on('error', (data: { message: string }) => {
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        content: `Error: ${data.message}`,
        role: 'assistant',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStreaming(false);
      setBackgroundProcessing(false);
      streamingContentRef.current = '';
      streamingIdRef.current = null;
      responseCompleteRef.current = false;
      intermediateCompletionRef.current = false;
    });

    socket.on('compact_boundary', () => {
      setMessages(prev => [...prev, {
        id: `compact_${Date.now()}`,
        content: '↻ Context compacted',
        role: 'assistant' as const,
        timestamp: Date.now(),
        isCompactBoundary: true,
      }]);
    });

    return () => {
      socket.off('message_received');
      socket.off('stream_active');
      socket.off('stream_content_sync');
      socket.off('thinking_delta');
      socket.off('text_delta');
      socket.off('response_complete');
      socket.off('error');
      socket.off('compact_boundary');
    };
  }, [socket, toolLogRef, activityTreeRef, hasRunningAgents, isRestoringSessionRef, currentSessionIdRef]);

  return {
    messages,
    setMessages,
    streaming,
    setStreaming,
    backgroundProcessing,
    setBackgroundProcessing,
    thinking,
    setThinking,
    usageStats,
    setUsageStats,
    contextTokens,
    setContextTokens,
    pendingRestore,
    setPendingRestore,
    // Export refs for other hooks to use
    streamingContentRef,
    streamingIdRef,
    responseCompleteRef,
    messageIndexRef,
    completionFinalizedRef,
    syncInProgressRef,
    streamActiveRef,
    awaitingDeltaAfterRestore,
    streamingRef,
    backgroundProcessingRef,
    thinkingRef,
    messagesRef,
  };
}
