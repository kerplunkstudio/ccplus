import { useState, useEffect, useRef, MutableRefObject, Dispatch } from 'react';
import { Socket } from 'socket.io-client';
import { ToolEvent, ActivityNode, PendingQuestion, SignalState, UsageStats, DBMessage, TodoItem } from '../types';
import { TreeAction } from './useActivityTree';
import { StreamAction } from './streamReducer';
import { MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from './useStreamingMessages';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface UseSessionRestoreProps {
  sessionId: string;
  socket: Socket | null;
  currentSessionIdRef: MutableRefObject<string>;
  prevSessionIdRef: MutableRefObject<string>;
  lastSeq: number;
  streamDispatch: Dispatch<StreamAction>;
  // Tool/activity state (these still need manual handling)
  toolLogRef: MutableRefObject<ToolEvent[]>;
  activityTreeRef: MutableRefObject<ActivityNode[]>;
  sequenceRef: MutableRefObject<number>;
  seenToolUseIds: MutableRefObject<Set<string>>;
  setToolLog: Dispatch<React.SetStateAction<ToolEvent[]>>;
  setCurrentTool: (tool: ToolEvent | null) => void;
  setPendingQuestion: (question: PendingQuestion | null) => void;
  setSignals: (signals: SignalState) => void;
  setTodos: (todos: TodoItem[]) => void;
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
  lastSeq,
  streamDispatch,
  toolLogRef,
  activityTreeRef,
  sequenceRef,
  seenToolUseIds,
  setToolLog,
  setCurrentTool,
  setPendingQuestion,
  setSignals,
  setTodos,
  setContextTokens,
  setUsageStats,
  dispatchTree,
  clearToolTimerRef,
  pendingWorkerRestartErrorRef,
  workerRestartGraceTimerRef,
}: UseSessionRestoreProps) {
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // Store lastSeq in a ref to avoid stale closure in reconnect handler
  const lastSeqRef = useRef(lastSeq);

  // Sync ref with prop value
  useEffect(() => {
    lastSeqRef.current = lastSeq;
  }, [lastSeq]);

  // Tab switch effect
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      const previousSessionId = prevSessionIdRef.current;
      prevSessionIdRef.current = sessionId;
      currentSessionIdRef.current = sessionId;

      setIsRestoringSession(true);

      // Clear stream state via reducer
      streamDispatch({ type: 'CLEAR' });

      // Clear tool/activity state
      dispatchTree({ type: 'CLEAR' });
      toolLogRef.current = [];
      setToolLog([]);
      sequenceRef.current = 0;
      seenToolUseIds.current.clear();
      setCurrentTool(null);
      setPendingQuestion(null);
      setSignals({ status: null });
      setTodos([]);
      setContextTokens(null);

      // Clear timers
      if (clearToolTimerRef.current) {
        clearTimeout(clearToolTimerRef.current);
        clearToolTimerRef.current = null;
      }
      pendingWorkerRestartErrorRef.current = null;
      if (workerRestartGraceTimerRef.current) {
        clearTimeout(workerRestartGraceTimerRef.current);
        workerRestartGraceTimerRef.current = null;
      }

      // Leave previous session room
      if (socket?.connected && previousSessionId) {
        socket.emit('leave_session', { session_id: previousSessionId });
      }
      // NOTE: join_session now happens AFTER DB history loads in restoreSession
      // to prevent stream_content_sync from being overwritten by LOAD_HISTORY
    }
  }, [sessionId, prevSessionIdRef, currentSessionIdRef, streamDispatch, toolLogRef, sequenceRef, seenToolUseIds, setToolLog, dispatchTree, setCurrentTool, setPendingQuestion, setSignals, setTodos, setContextTokens, clearToolTimerRef, pendingWorkerRestartErrorRef, workerRestartGraceTimerRef, socket]);

  // Session restore effect
  useEffect(() => {
    if (!sessionId) return;
    let isMounted = true;

    const restoreSession = async () => {
      try {
        // Fetch history from DB
        const historyRes = await fetch(`${SOCKET_URL}/api/history/${sessionId}`);
        if (!isMounted || !historyRes.ok) return;

        const data = await historyRes.json();
        const { messages: dbMessages, streaming: isStreaming, context_tokens, model, streamingContent } = data;

        if (context_tokens != null) setContextTokens(context_tokens);
        if (model) {
          // Update usage stats with model info
          const windowSize = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
          setUsageStats(prev => ({ ...prev, contextWindowSize: windowSize, model }));
        }

        if (dbMessages && dbMessages.length > 0) {
          const restored = dbMessages.map((m: DBMessage) => ({
            id: `db_${m.id}`,
            content: m.content,
            role: m.role as 'user' | 'assistant',
            timestamp: new Date(m.timestamp).getTime(),
            images: m.images || [],
          }));

          // Load into reducer with streaming content buffer from server
          streamDispatch({ type: 'LOAD_HISTORY', messages: restored, isActive: isStreaming, streamingContent: streamingContent || undefined });
        } else if (isStreaming) {
          streamDispatch({ type: 'SET_STREAMING', value: true });
        }

        // Restore activity tree
        const activityRes = await fetch(`${SOCKET_URL}/api/activity/${sessionId}`);
        if (!isMounted || !activityRes.ok) return;

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

          if (isStreaming) {
            const completedIds = new Set<string>();
            for (const e of toolEvents) {
              if (e.type === 'tool_complete' || e.type === 'agent_stop') {
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
            }
          }

          // Restore todos from last TodoWrite event
          const lastTodoEvent = [...events].reverse().find(
            (e: any) => e.tool_name === 'TodoWrite' && e.parameters?.todos
          );
          if (lastTodoEvent) {
            setTodos(lastTodoEvent.parameters.todos as TodoItem[]);
          }
        }

        // NOW join the session room — this triggers stream_content_sync from the server
        // which layers current streaming content on top of the DB history we just loaded
        if (!isMounted) return;
        if (socket?.connected) {
          socket.emit('join_session', { session_id: sessionId, last_seq: 0 });
        }
      } catch (err) {
        // Failed to restore session state — safe to ignore
      } finally {
        if (isMounted) {
          setIsRestoringSession(false);
        }
      }
    };

    restoreSession();
    return () => { isMounted = false; };
  }, [sessionId, socket, streamDispatch, setContextTokens, setUsageStats, dispatchTree, seenToolUseIds, setCurrentTool, setTodos]);

  // Reconnect effect
  // Uses ref pattern to avoid stale closure — reconnect handler always reads latest lastSeq
  useEffect(() => {
    if (!socket) return;

    const handleReconnect = () => {
      const activeSessionId = currentSessionIdRef.current;
      if (!activeSessionId) return;

      // Rejoin with our cursor — server replays missed events
      // Use ref to get the latest lastSeq value (avoid stale closure)
      socket.emit('join_session', {
        session_id: activeSessionId,
        last_seq: lastSeqRef.current
      });
    };

    const handleFullResetRequired = async (data: { session_id: string }) => {
      if (data.session_id !== currentSessionIdRef.current) return;

      // Client is too far behind - need full session restore
      try {
        setIsRestoringSession(true);

        // Re-fetch history from database
        const historyRes = await fetch(`${SOCKET_URL}/api/history/${data.session_id}`);
        if (!historyRes.ok) return;

        const historyData = await historyRes.json();
        const { messages: dbMessages, streaming: isStreaming, context_tokens, model, streamingContent } = historyData;

        if (context_tokens != null) setContextTokens(context_tokens);
        if (model) {
          const windowSize = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
          setUsageStats(prev => ({ ...prev, contextWindowSize: windowSize, model }));
        }

        if (dbMessages && dbMessages.length > 0) {
          const restored = dbMessages.map((m: DBMessage) => ({
            id: `db_${m.id}`,
            content: m.content,
            role: m.role as 'user' | 'assistant',
            timestamp: new Date(m.timestamp).getTime(),
            images: m.images || [],
          }));

          streamDispatch({ type: 'LOAD_HISTORY', messages: restored, isActive: isStreaming, streamingContent: streamingContent || undefined });
        } else if (isStreaming) {
          streamDispatch({ type: 'SET_STREAMING', value: true });
        }

        // Re-fetch activity events
        const activityRes = await fetch(`${SOCKET_URL}/api/activity/${data.session_id}`);
        if (!activityRes.ok) return;

        const { events } = await activityRes.json();

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

          if (isStreaming) {
            const completedIds = new Set<string>();
            for (const e of toolEvents) {
              if (e.type === 'tool_complete' || e.type === 'agent_stop') {
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
            }
          }

          // Restore todos from last TodoWrite event
          const lastTodoEvent = [...events].reverse().find(
            (e: any) => e.tool_name === 'TodoWrite' && e.parameters?.todos
          );
          if (lastTodoEvent) {
            setTodos(lastTodoEvent.parameters.todos as TodoItem[]);
          }
        }

        // Rejoin session with reset cursor
        if (socket.connected) {
          socket.emit('join_session', { session_id: data.session_id, last_seq: 0 });
        }
      } catch (err) {
        // Failed to restore - safe to ignore
      } finally {
        setIsRestoringSession(false);
      }
    };

    socket.io.on('reconnect', handleReconnect);
    socket.on('full_reset_required', handleFullResetRequired);
    return () => {
      socket.io.off('reconnect', handleReconnect);
      socket.off('full_reset_required');
    };
  }, [socket, currentSessionIdRef, streamDispatch, setContextTokens, setUsageStats, dispatchTree, seenToolUseIds, setCurrentTool, setTodos]);

  return {
    isRestoringSession,
  };
}
