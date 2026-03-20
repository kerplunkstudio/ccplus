import { useState, useEffect, useRef, useCallback, MutableRefObject, Dispatch } from 'react';
import { Socket } from 'socket.io-client';
import { ToolEvent, SignalState, TodoItem } from '../types';
import { TreeAction } from './useActivityTree';
import { StreamAction } from './streamReducer';

interface UseToolEventsProps {
  socket: Socket | null;
  dispatchTree: Dispatch<TreeAction>;
  currentSessionIdRef: MutableRefObject<string>;
  streamDispatch: Dispatch<StreamAction>;
  sequenceRef: MutableRefObject<number>;
  seenToolUseIds: MutableRefObject<Set<string>>;
  toolLogRef: MutableRefObject<ToolEvent[]>;
  onDevServerDetected?: (url: string) => void;
}

export function useToolEvents({
  socket,
  dispatchTree,
  currentSessionIdRef,
  streamDispatch,
  sequenceRef,
  seenToolUseIds,
  toolLogRef,
  onDevServerDetected,
}: UseToolEventsProps) {
  const [currentTool, setCurrentTool] = useState<ToolEvent | null>(null);
  const [toolLog, setToolLog] = useState<ToolEvent[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<{
    questions: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description: string }>;
      multiSelect: boolean;
    }>;
    toolUseId: string;
  } | null>(null);
  const [signals, setSignals] = useState<SignalState>({ status: null });
  const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
  const [rateLimitState, setRateLimitState] = useState<{ active: boolean; retryAfterMs: number } | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const clearToolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setCurrentToolDebounced = useCallback((tool: ToolEvent | null) => {
    if (clearToolTimerRef.current) {
      clearTimeout(clearToolTimerRef.current);
      clearToolTimerRef.current = null;
    }
    if (tool !== null) {
      setCurrentTool(tool);
    } else {
      clearToolTimerRef.current = setTimeout(() => {
        setCurrentTool(null);
        clearToolTimerRef.current = null;
      }, 300);
    }
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('tool_event', (event: ToolEvent) => {
      if (event.session_id && event.session_id !== currentSessionIdRef.current) return;

      if ((event.type === 'tool_start' || event.type === 'agent_start') && event.tool_use_id) {
        if (seenToolUseIds.current.has(event.tool_use_id)) {
          return;
        }
        seenToolUseIds.current.add(event.tool_use_id);
      }

      switch (event.type) {
        case 'todo_update': {
          if (event.parameters?.todos && Array.isArray(event.parameters.todos)) {
            setTodos(event.parameters.todos as TodoItem[]);
          }
          break;
        }
        case 'agent_start': {
          streamDispatch({ type: 'FINALIZE_STREAM' });
          streamDispatch({ type: 'SET_STREAMING', value: true });

          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'AGENT_START', event, sequence: seq });
          setCurrentToolDebounced(event);
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_start': {
          streamDispatch({ type: 'FINALIZE_STREAM' });
          streamDispatch({ type: 'SET_STREAMING', value: true });

          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'TOOL_START', event, sequence: seq });
          setCurrentToolDebounced(event);
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_complete': {
          dispatchTree({ type: 'TOOL_COMPLETE', event });
          setCurrentToolDebounced(null);
          const isWorkerRestartTool = event.error === 'Worker restarted';
          toolLogRef.current = toolLogRef.current.map((t) =>
            t.tool_use_id === event.tool_use_id
              ? { ...t, success: event.success, duration_ms: event.duration_ms, error: isWorkerRestartTool ? undefined : event.error, type: event.type }
              : t
          );
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'agent_stop':
          dispatchTree({ type: 'AGENT_STOP', event });
          setCurrentToolDebounced(null);
          const isWorkerRestartAgent = event.error === 'Worker restarted';
          toolLogRef.current = toolLogRef.current.map((t) =>
            t.tool_use_id === event.tool_use_id
              ? { ...t, success: event.success, duration_ms: event.duration_ms, error: isWorkerRestartAgent ? undefined : event.error, type: event.type }
              : t
          );
          setToolLog([...toolLogRef.current]);
          break;
      }
    });

    socket.on('user_question', (data: { questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }>; tool_use_id: string }) => {
      setPendingQuestion({
        questions: data.questions,
        toolUseId: data.tool_use_id,
      });
    });

    socket.on('signal', (signal: { type: string; data: Record<string, unknown> }) => {
      switch (signal.type) {
        case 'status':
          setSignals({
            status: {
              phase: signal.data.phase as NonNullable<SignalState['status']>['phase'],
              detail: signal.data.detail as string | undefined,
            },
          });
          break;
      }
    });

    socket.on('tool_progress', (data: { tool_use_id: string; elapsed_seconds: number }) => {
      dispatchTree({ type: 'TOOL_PROGRESS', toolUseId: data.tool_use_id, elapsedSeconds: data.elapsed_seconds });
    });

    socket.on('rate_limit', (data: { retryAfterMs: number; rateLimitedAt: string }) => {
      setRateLimitState({ active: true, retryAfterMs: data.retryAfterMs });
      setTimeout(() => {
        setRateLimitState(null);
      }, data.retryAfterMs);
    });

    socket.on('prompt_suggestions', (data: { suggestions: string[] }) => {
      setPromptSuggestions(data.suggestions);
    });

    socket.on('dev_server_detected', (data: { url: string; session_id: string }) => {
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;
      if (onDevServerDetected) {
        onDevServerDetected(data.url);
      }
    });

    socket.on('todo_sync', (data: { todos: TodoItem[]; session_id: string }) => {
      if (data.session_id && data.session_id !== currentSessionIdRef.current) return;
      setTodos(data.todos);
    });

    return () => {
      socket.off('tool_event');
      socket.off('user_question');
      socket.off('signal');
      socket.off('tool_progress');
      socket.off('rate_limit');
      socket.off('prompt_suggestions');
      socket.off('dev_server_detected');
      socket.off('todo_sync');
      if (clearToolTimerRef.current) {
        clearTimeout(clearToolTimerRef.current);
        clearToolTimerRef.current = null;
      }
    };
  }, [socket, dispatchTree, currentSessionIdRef, streamDispatch, sequenceRef, seenToolUseIds, toolLogRef, setCurrentToolDebounced, onDevServerDetected]);

  return {
    currentTool,
    setCurrentTool,
    toolLog,
    setToolLog,
    toolLogRef,
    pendingQuestion,
    setPendingQuestion,
    signals,
    setSignals,
    promptSuggestions,
    setPromptSuggestions,
    rateLimitState,
    setRateLimitState,
    todos,
    setTodos,
  };
}
