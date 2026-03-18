import { useState, useEffect, useRef, MutableRefObject, Dispatch } from 'react';
import { Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode, PendingQuestion, SignalState, UsageStats, DBMessage, DBToolEvent } from '../types';
import { TreeAction } from './useActivityTree';
import { fetchUserStats } from './useStreamingMessages';

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

type SessionCache = {
  messages: Message[];
  streamingContent: string;
  streamingId: string | null;
  toolLog: ToolEvent[];
  activityTree: ActivityNode[];
  sequenceCounter: number;
  seenIds: Set<string>;
  streaming: boolean;
  backgroundProcessing: boolean;
  thinking: string;
  contextTokens: number | null;
};

interface UseSessionRestoreProps {
  sessionId: string;
  socket: Socket | null;
  currentSessionIdRef: MutableRefObject<string>;
  prevSessionIdRef: MutableRefObject<string>;
  sessionCacheRef: MutableRefObject<Map<string, SessionCache>>;
  messagesRef: MutableRefObject<Message[]>;
  streamingRef: MutableRefObject<boolean>;
  backgroundProcessingRef: MutableRefObject<boolean>;
  thinkingRef: MutableRefObject<string>;
  streamingContentRef: MutableRefObject<string>;
  streamingIdRef: MutableRefObject<string | null>;
  toolLogRef: MutableRefObject<ToolEvent[]>;
  activityTreeRef: MutableRefObject<ActivityNode[]>;
  sequenceRef: MutableRefObject<number>;
  seenToolUseIds: MutableRefObject<Set<string>>;
  streamActiveRef: MutableRefObject<boolean>;
  awaitingDeltaAfterRestore: MutableRefObject<boolean>;
  responseCompleteRef: MutableRefObject<boolean>;
  completionFinalizedRef: MutableRefObject<boolean>;
  messageIndexRef: MutableRefObject<number>;
  contextTokens: number | null;
  isRestoringSessionRef: MutableRefObject<boolean>; // Shared ref from useTabSocket
  // Setters
  setMessages: Dispatch<React.SetStateAction<Message[]>>;
  setStreaming: (streaming: boolean) => void;
  setBackgroundProcessing: (processing: boolean) => void;
  setThinking: (thinking: string) => void;
  setToolLog: Dispatch<React.SetStateAction<ToolEvent[]>>;
  setCurrentTool: (tool: ToolEvent | null) => void;
  setPendingQuestion: (question: PendingQuestion | null) => void;
  setPendingRestore: (pending: boolean) => void;
  setSignals: (signals: SignalState) => void;
  setContextTokens: (tokens: number | null) => void;
  setUsageStats: Dispatch<React.SetStateAction<UsageStats>>;
  dispatchTree: Dispatch<TreeAction>;
  clearToolTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingWorkerRestartErrorRef: MutableRefObject<{ message: string; timestamp: number } | null>;
  workerRestartGraceTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useSessionRestore({
  sessionId,
  socket,
  currentSessionIdRef,
  prevSessionIdRef,
  sessionCacheRef,
  messagesRef,
  streamingRef,
  backgroundProcessingRef,
  thinkingRef,
  streamingContentRef,
  streamingIdRef,
  toolLogRef,
  activityTreeRef,
  sequenceRef,
  seenToolUseIds,
  streamActiveRef,
  awaitingDeltaAfterRestore,
  responseCompleteRef,
  completionFinalizedRef,
  messageIndexRef,
  contextTokens,
  isRestoringSessionRef, // Shared ref from useTabSocket
  setMessages,
  setStreaming,
  setBackgroundProcessing,
  setThinking,
  setToolLog,
  setCurrentTool,
  setPendingQuestion,
  setPendingRestore,
  setSignals,
  setContextTokens,
  setUsageStats,
  dispatchTree,
  clearToolTimerRef,
  pendingWorkerRestartErrorRef,
  workerRestartGraceTimerRef,
}: UseSessionRestoreProps) {
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // Tab switch effect
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      const previousSessionId = prevSessionIdRef.current;

      // Save current state to cache BEFORE resetting (if there are messages)
      if (messagesRef.current.length > 0) {
        sessionCacheRef.current.set(previousSessionId, {
          messages: messagesRef.current,
          streamingContent: streamingContentRef.current,
          streamingId: streamingIdRef.current,
          toolLog: [...toolLogRef.current],
          activityTree: [...activityTreeRef.current],
          sequenceCounter: sequenceRef.current,
          seenIds: new Set(seenToolUseIds.current),
          streaming: streamingRef.current,
          backgroundProcessing: backgroundProcessingRef.current,
          thinking: thinkingRef.current,
          contextTokens: contextTokens,
        });
      }

      prevSessionIdRef.current = sessionId;
      currentSessionIdRef.current = sessionId;
      setIsRestoringSession(true);
      isRestoringSessionRef.current = true;
      setMessages([]);
      dispatchTree({ type: 'CLEAR' });
      setStreaming(false);
      setBackgroundProcessing(false);
      setThinking('');
      if (clearToolTimerRef.current) {
        clearTimeout(clearToolTimerRef.current);
        clearToolTimerRef.current = null;
      }
      setCurrentTool(null);
      toolLogRef.current = [];
      setToolLog([]);
      streamingContentRef.current = '';
      streamingIdRef.current = null;
      responseCompleteRef.current = false;
      streamActiveRef.current = false;
      sequenceRef.current = 0;
      seenToolUseIds.current.clear();
      setPendingQuestion(null);
      pendingWorkerRestartErrorRef.current = null;
      if (workerRestartGraceTimerRef.current) {
        clearTimeout(workerRestartGraceTimerRef.current);
        workerRestartGraceTimerRef.current = null;
      }
      awaitingDeltaAfterRestore.current = false;
      setPendingRestore(false);
      setSignals({ status: null });
      setContextTokens(null);

      // Switch rooms on persistent socket
      if (socket?.connected) {
        if (previousSessionId) {
          socket.emit('leave_session', { session_id: previousSessionId });
        }
        socket.emit('join_session', { session_id: sessionId });
      }
    }
  }, [sessionId, prevSessionIdRef, currentSessionIdRef, sessionCacheRef, messagesRef, streamingRef, backgroundProcessingRef, thinkingRef, streamingContentRef, streamingIdRef, toolLogRef, activityTreeRef, sequenceRef, seenToolUseIds, isRestoringSessionRef, setMessages, dispatchTree, setStreaming, setBackgroundProcessing, setThinking, clearToolTimerRef, setCurrentTool, setToolLog, responseCompleteRef, streamActiveRef, setPendingQuestion, pendingWorkerRestartErrorRef, workerRestartGraceTimerRef, awaitingDeltaAfterRestore, setPendingRestore, setSignals, setContextTokens, socket]);

  // Session restore effect
  useEffect(() => {
    if (!sessionId) return;

    let isMounted = true;
    const restoreSession = async () => {
      try {
        const cachedSession = sessionCacheRef.current.get(sessionId);
        let sessionIsActive = false;

        if (cachedSession) {
          if (!isMounted) return;
          setMessages(cachedSession.messages);
          streamingContentRef.current = cachedSession.streamingContent;
          streamingIdRef.current = cachedSession.streamingId;
          toolLogRef.current = cachedSession.toolLog;
          setToolLog(cachedSession.toolLog);
          sequenceRef.current = cachedSession.sequenceCounter;
          seenToolUseIds.current = cachedSession.seenIds;
          setStreaming(cachedSession.streaming);
          setBackgroundProcessing(cachedSession.backgroundProcessing);
          setThinking(cachedSession.thinking);
          setContextTokens(cachedSession.contextTokens);
          sessionIsActive = cachedSession.streaming || cachedSession.backgroundProcessing;
        } else {
          const historyRes = await fetch(`${SOCKET_URL}/api/history/${sessionId}`);
          if (historyRes.ok) {
            const data = await historyRes.json();
            const { messages: dbMessages, streaming: isStreaming, context_tokens, model } = data;
            sessionIsActive = isStreaming || streamActiveRef.current;

            if (!isMounted) return;

            if (context_tokens != null) {
              setContextTokens(context_tokens);
            }
            if (model) {
              const windowSize = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
              setUsageStats((prev) => ({ ...prev, contextWindowSize: windowSize, model: model }));
            }

            if (dbMessages && dbMessages.length > 0) {
              const restored: Message[] = dbMessages.map((m: DBMessage) => ({
                id: `db_${m.id}`,
                content: m.content,
                role: m.role as 'user' | 'assistant',
                timestamp: new Date(m.timestamp).getTime(),
                images: m.images || [],
              }));

              if (sessionIsActive) {
                streamActiveRef.current = false;
                const lastMsg = restored[restored.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  streamingIdRef.current = lastMsg.id;
                  // Prefer buffered sync content (from stream_content_sync during restore) over DB content
                  if (!streamingContentRef.current) {
                    streamingContentRef.current = lastMsg.content || '';
                  }
                  setStreaming(true);
                  awaitingDeltaAfterRestore.current = true;
                  setPendingRestore(true);
                  setMessages(restored.map((m) =>
                    m.id === lastMsg.id ? { ...m, streaming: true } : m
                  ));
                } else {
                  setStreaming(true);
                  awaitingDeltaAfterRestore.current = true;
                  setPendingRestore(true);
                  setMessages(restored);
                }
              } else {
                setMessages(restored);
              }
            } else if (sessionIsActive) {
              setStreaming(true);
            }
          }
        }

        // ALWAYS restore activity tree from DB
        const activityRes = await fetch(`${SOCKET_URL}/api/activity/${sessionId}`);
        if (!isMounted) return;
        if (activityRes.ok) {
          const { events } = await activityRes.json();
          if (!isMounted) return;
          if (events && events.length > 0) {
            const toolEvents: ToolEvent[] = [];
            for (const e of events) {
              const isAgent = !!e.agent_type;
              toolEvents.push({
                type: isAgent ? 'agent_start' : 'tool_start',
                tool_name: e.tool_name,
                tool_use_id: e.tool_use_id,
                parent_agent_id: e.parent_agent_id || null,
                agent_type: e.agent_type,
                timestamp: e.timestamp,
                success: undefined,
                error: undefined,
                duration_ms: undefined,
                parameters: e.parameters,
                description: e.description,
              } as ToolEvent);
              if (e.success !== null && e.success !== undefined) {
                toolEvents.push({
                  type: isAgent ? 'agent_stop' : 'tool_complete',
                  tool_name: e.tool_name,
                  tool_use_id: e.tool_use_id,
                  parent_agent_id: e.parent_agent_id || null,
                  agent_type: e.agent_type,
                  timestamp: e.timestamp,
                  success: e.success,
                  error: e.error,
                  duration_ms: e.duration_ms,
                  parameters: e.parameters,
                } as ToolEvent);
              }
            }
            dispatchTree({ type: 'LOAD_HISTORY', events: toolEvents });
            toolEvents.forEach(e => {
              if (e.tool_use_id) seenToolUseIds.current.add(e.tool_use_id);
            });

            if (sessionIsActive) {
              const startedIds = new Set<string>();
              const completedIds = new Set<string>();
              for (const e of toolEvents) {
                if (e.type === 'tool_start' || e.type === 'agent_start') {
                  startedIds.add(e.tool_use_id!);
                } else if (e.type === 'tool_complete' || e.type === 'agent_stop') {
                  completedIds.add(e.tool_use_id!);
                }
              }
              const lastRunning = [...toolEvents]
                .reverse()
                .find(e =>
                  (e.type === 'tool_start' || e.type === 'agent_start') &&
                  !completedIds.has(e.tool_use_id!)
                );
              if (lastRunning) {
                setCurrentTool(lastRunning);
                setStreaming(true);
              }
            }
          }
        }
      } catch (err) {
        console.error('[useSessionRestore] Failed to restore session:', err);
      } finally {
        if (isMounted) {
          setIsRestoringSession(false);
          isRestoringSessionRef.current = false;
          sessionCacheRef.current.delete(sessionId);
        }
      }
    };

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [sessionId, sessionCacheRef, streamingContentRef, streamingIdRef, toolLogRef, sequenceRef, seenToolUseIds, streamActiveRef, awaitingDeltaAfterRestore, isRestoringSessionRef, setMessages, setToolLog, setStreaming, setBackgroundProcessing, setThinking, setContextTokens, setUsageStats, dispatchTree, setCurrentTool, setPendingRestore]);

  // Reconnect restore logic
  useEffect(() => {
    if (!socket) return;

    let isMounted = true;
    const handleReconnect = () => {
      const restoreAfterReconnect = async () => {
        try {
          if (!isMounted) return;
          const activeSessionId = currentSessionIdRef.current;
          if (!activeSessionId) return;

          let sessionIsActive = false;
          const historyRes = await fetch(`${SOCKET_URL}/api/history/${activeSessionId}`);
          if (!isMounted) return;
          if (historyRes.ok) {
            const { messages: dbMessages, streaming: isStreaming } = await historyRes.json();
            if (!isMounted) return;
            sessionIsActive = isStreaming || streamActiveRef.current;

            if (dbMessages && dbMessages.length > 0) {
              const restored: Message[] = dbMessages.map((m: DBMessage) => ({
                id: `db_${m.id}`,
                content: m.content,
                role: m.role as 'user' | 'assistant',
                timestamp: new Date(m.timestamp).getTime(),
                images: m.images || [],
              }));

              if (sessionIsActive) {
                streamActiveRef.current = false;
                const lastMsg = restored[restored.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  streamingIdRef.current = lastMsg.id;
                  // Prefer buffered sync content (from stream_content_sync during restore) over DB content
                  if (!streamingContentRef.current) {
                    streamingContentRef.current = lastMsg.content || '';
                  }
                  setStreaming(true);
                  awaitingDeltaAfterRestore.current = true;
                  setPendingRestore(true);
                  setMessages(restored.map((m) =>
                    m.id === lastMsg.id ? { ...m, streaming: true } : m
                  ));
                } else {
                  setStreaming(true);
                  awaitingDeltaAfterRestore.current = true;
                  setPendingRestore(true);
                  setMessages(restored);
                }
              } else {
                setMessages(restored);
              }
            } else if (sessionIsActive) {
              setStreaming(true);
            }
          }

          const activityRes = await fetch(`${SOCKET_URL}/api/activity/${activeSessionId}`);
          if (!isMounted) return;
          if (activityRes.ok) {
            const { events } = await activityRes.json();
            if (!isMounted) return;
            if (events && events.length > 0) {
              const toolEvents: ToolEvent[] = [];
              for (const e of events) {
                const isAgent = !!e.agent_type;
                toolEvents.push({
                  type: isAgent ? 'agent_start' : 'tool_start',
                  tool_name: e.tool_name,
                  tool_use_id: e.tool_use_id,
                  parent_agent_id: e.parent_agent_id || null,
                  agent_type: e.agent_type,
                  timestamp: e.timestamp,
                  success: undefined,
                  error: undefined,
                  duration_ms: undefined,
                  parameters: e.parameters,
                  description: e.description,
                } as ToolEvent);
                if (e.success !== null && e.success !== undefined) {
                  toolEvents.push({
                    type: isAgent ? 'agent_stop' : 'tool_complete',
                    tool_name: e.tool_name,
                    tool_use_id: e.tool_use_id,
                    parent_agent_id: e.parent_agent_id || null,
                    agent_type: e.agent_type,
                    timestamp: e.timestamp,
                    success: e.success,
                    error: e.error,
                    duration_ms: e.duration_ms,
                    parameters: e.parameters,
                  } as ToolEvent);
                }
              }
              dispatchTree({ type: 'LOAD_HISTORY', events: toolEvents });
              toolEvents.forEach(e => {
                if (e.tool_use_id) seenToolUseIds.current.add(e.tool_use_id);
              });

              if (sessionIsActive) {
                const startedIds = new Set<string>();
                const completedIds = new Set<string>();
                for (const e of toolEvents) {
                  if (e.type === 'tool_start' || e.type === 'agent_start') {
                    startedIds.add(e.tool_use_id!);
                  } else if (e.type === 'tool_complete' || e.type === 'agent_stop') {
                    completedIds.add(e.tool_use_id!);
                  }
                }
                const lastRunning = [...toolEvents]
                  .reverse()
                  .find(e =>
                    (e.type === 'tool_start' || e.type === 'agent_start') &&
                    !completedIds.has(e.tool_use_id!)
                  );
                if (lastRunning) {
                  setCurrentTool(lastRunning);
                  setStreaming(true);
                }
              }
            }
          }
        } catch (err) {
          console.error('[useSessionRestore] Failed to restore after reconnect:', err);
        }
      };

      restoreAfterReconnect();
    };

    socket.io.on('reconnect', handleReconnect);

    return () => {
      isMounted = false;
      socket.io.off('reconnect', handleReconnect);
    };
  }, [socket, currentSessionIdRef, streamActiveRef, streamingIdRef, streamingContentRef, awaitingDeltaAfterRestore, seenToolUseIds, setStreaming, setPendingRestore, setMessages, dispatchTree, setCurrentTool]);

  return {
    isRestoringSession,
  };
}
