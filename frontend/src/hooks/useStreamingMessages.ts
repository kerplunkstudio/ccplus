import { useState, useEffect, useReducer, MutableRefObject } from 'react';
import { Socket } from 'socket.io-client';
import { Message, UsageStats, ToolEvent, ActivityNode } from '../types';
import { streamReducer, initialStreamState } from './streamReducer';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-6': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
  'sonnet': 1_000_000,
  'opus': 1_000_000,
  'haiku': 200_000,
};
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

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
  currentSessionIdRef: MutableRefObject<string>;
  sessionId: string;
}

export function useStreamingMessages({
  socket,
  toolLogRef,
  activityTreeRef,
  hasRunningAgents,
  currentSessionIdRef,
  sessionId,
}: UseStreamingMessagesProps) {
  // Use reducer for stream state
  const [state, dispatch] = useReducer(streamReducer, initialStreamState);

  // Independent state (not in reducer)
  const [usageStats, setUsageStats] = useState<UsageStats>({
    totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
    totalDuration: 0, queryCount: 0, contextWindowSize: DEFAULT_CONTEXT_WINDOW,
    model: '', linesOfCode: 0, totalSessions: 0,
  });
  const [contextTokens, setContextTokens] = useState<number | null>(null);

  // Fetch persisted stats from backend on mount
  useEffect(() => {
    fetchUserStats().then(setUsageStats);
  }, []);

  // Safety cleanup: Clear backgroundProcessing if no agents are running
  useEffect(() => {
    if (!state.backgroundProcessing || state.streaming) return;

    const cleanupTimer = setTimeout(() => {
      const hasRunning = hasRunningAgents(activityTreeRef.current);
      if (!hasRunning && state.backgroundProcessing) {
        dispatch({ type: 'SET_BACKGROUND_PROCESSING', value: false });
        toolLogRef.current = [];
      }
    }, 500);

    return () => clearTimeout(cleanupTimer);
  }, [state.backgroundProcessing, state.streaming, activityTreeRef, hasRunningAgents, toolLogRef]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    // rAF batching state for text_delta
    const rafBufferRef = { current: '' };
    const rafPendingRef = { current: false };
    const rafHandleRef = { current: 0 };
    const rafLatestMessageIndexRef = { current: 0 };
    const rafLatestSeqRef = { current: 0 };

    const flushTextDeltas = () => {
      if (rafBufferRef.current) {
        dispatch({
          type: 'TEXT_DELTA',
          text: rafBufferRef.current,
          messageIndex: rafLatestMessageIndexRef.current,
          seq: rafLatestSeqRef.current
        });
        rafBufferRef.current = '';
      }
      rafPendingRef.current = false;
    };

    socket.on('message_received', () => {
      window.dispatchEvent(new CustomEvent('ccplus_message_received'));
    });

    socket.on('stream_active', (data?: { session_id?: string; seq?: number }) => {
      if (data?.session_id && data.session_id !== currentSessionIdRef.current) return;
      dispatch({ type: 'STREAM_ACTIVE', seq: data?.seq ?? 0 });
    });

    socket.on('thinking_delta', (data: { text: string }) => {
      dispatch({ type: 'THINKING_DELTA', text: data.text });
    });

    socket.on('text_delta', (data: { text: string; message_id?: string; message_index?: number; session_id?: string; seq?: number; replay?: boolean }) => {
      // Filter before buffering
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;

      // Accumulate text in buffer
      rafBufferRef.current += data.text;
      rafLatestMessageIndexRef.current = data.message_index ?? 0;
      rafLatestSeqRef.current = data.seq ?? 0;

      // Schedule rAF flush if not already pending
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        rafHandleRef.current = requestAnimationFrame(flushTextDeltas);
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
      seq?: number;
    }) => {
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;

      const isFinalCompletion = data.sdk_session_id !== null && data.sdk_session_id !== undefined;

      // Dispatch to reducer
      dispatch({
        type: 'RESPONSE_COMPLETE',
        data,
        toolLog: [...toolLogRef.current],
        seq: data.seq ?? 0
      });

      // Side effects for usage stats and context tokens
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
        toolLogRef.current = [];
      } else {
        // Intermediate completion - set background processing if agents running
        setTimeout(() => {
          const hasRunning = hasRunningAgents(activityTreeRef.current);
          if (hasRunning) {
            dispatch({ type: 'SET_BACKGROUND_PROCESSING', value: true });
          } else {
            setTimeout(() => {
              toolLogRef.current = [];
            }, 1000);
          }
        }, 100);
      }
    });

    socket.on('error', (data: { message: string; seq?: number }) => {
      dispatch({ type: 'ERROR', message: data.message, seq: data.seq ?? 0 });
    });

    socket.on('compact_boundary', (data?: { seq?: number }) => {
      dispatch({ type: 'COMPACT_BOUNDARY', seq: data?.seq ?? 0 });
    });

    socket.on('stream_content_sync', (data: { content: string; session_id?: string; seq?: number }) => {
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;
      dispatch({ type: 'STREAM_CONTENT_SYNC', content: data.content, seq: data.seq ?? 0 });
    });

    return () => {
      // Cancel pending rAF and flush remaining buffer
      if (rafHandleRef.current) {
        cancelAnimationFrame(rafHandleRef.current);
      }
      flushTextDeltas();

      socket.off('message_received');
      socket.off('stream_active');
      socket.off('thinking_delta');
      socket.off('text_delta');
      socket.off('response_complete');
      socket.off('error');
      socket.off('compact_boundary');
      socket.off('stream_content_sync');
    };
  }, [socket, toolLogRef, activityTreeRef, hasRunningAgents, currentSessionIdRef]);

  return {
    // From reducer state
    messages: state.messages,
    streaming: state.streaming,
    backgroundProcessing: state.backgroundProcessing,
    thinking: state.thinking,
    lastSeq: state.lastSeq,
    // Dispatch for other hooks
    streamDispatch: dispatch,
    // Setter for messages (for direct manipulation by session restore)
    setMessages: (msgs: Message[]) => dispatch({ type: 'LOAD_HISTORY', messages: msgs, isActive: false }),
    // Independent state
    usageStats,
    setUsageStats,
    contextTokens,
    setContextTokens,
  };
}
