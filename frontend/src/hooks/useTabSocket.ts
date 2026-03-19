import { useRef } from 'react';
import { ToolEvent, UsageStats } from '../types';
import { useActivityTree } from './useActivityTree';
import { useSocketConnection } from './useSocketConnection';
import { useStreamingMessages } from './useStreamingMessages';
import { useToolEvents } from './useToolEvents';
import { useSessionRestore } from './useSessionRestore';
import { useSessionActions } from './useSessionActions';
import { useScheduler } from './useScheduler';

interface UseTabSocketProps {
  onDevServerDetected?: (url: string) => void;
}

export function useTabSocket(sessionId: string, props?: UseTabSocketProps) {
  const onDevServerDetected = props?.onDevServerDetected;
  // Session tracking refs
  const currentSessionIdRef = useRef<string>(sessionId);
  const prevSessionIdRef = useRef(sessionId);
  const sequenceRef = useRef(0);
  const seenToolUseIds = useRef<Set<string>>(new Set());

  // Worker restart error tracking
  const pendingWorkerRestartErrorRef = useRef<{ message: string; timestamp: number } | null>(null);
  const workerRestartGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Activity tree hook
  const {
    activityTree,
    activityTreeRef,
    dispatchTree,
    hasRunningAgents,
  } = useActivityTree();

  // Socket connection hook
  const {
    socket,
    connected,
  } = useSocketConnection({ currentSessionIdRef });

  // Shared refs that need to exist before hooks
  const clearToolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolLogRef = useRef<ToolEvent[]>([]);

  // Streaming messages hook
  const streamingHook = useStreamingMessages({
    socket,
    toolLogRef,
    activityTreeRef,
    hasRunningAgents,
    currentSessionIdRef,
    sessionId,
  });

  // Tool events hook
  const toolEvents = useToolEvents({
    socket,
    dispatchTree,
    currentSessionIdRef,
    streamDispatch: streamingHook.streamDispatch,
    sequenceRef,
    seenToolUseIds,
    toolLogRef,
    onDevServerDetected,
  });

  // Session restore hook
  const { isRestoringSession } = useSessionRestore({
    sessionId,
    socket,
    currentSessionIdRef,
    prevSessionIdRef,
    lastSeq: streamingHook.lastSeq,
    streamDispatch: streamingHook.streamDispatch,
    toolLogRef,
    activityTreeRef,
    sequenceRef,
    seenToolUseIds,
    setToolLog: toolEvents.setToolLog,
    setCurrentTool: toolEvents.setCurrentTool,
    setPendingQuestion: toolEvents.setPendingQuestion,
    setSignals: toolEvents.setSignals,
    setContextTokens: streamingHook.setContextTokens,
    setUsageStats: streamingHook.setUsageStats,
    dispatchTree,
    clearToolTimerRef,
    pendingWorkerRestartErrorRef,
    workerRestartGraceTimerRef,
  });

  // Session actions hook
  const actions = useSessionActions({
    socket,
    connected,
    currentSessionIdRef,
    backgroundProcessing: streamingHook.backgroundProcessing,
    streamDispatch: streamingHook.streamDispatch,
    setCurrentTool: toolEvents.setCurrentTool,
    setPendingQuestion: toolEvents.setPendingQuestion,
    setPromptSuggestions: toolEvents.setPromptSuggestions,
    setSignals: toolEvents.setSignals,
    toolLogRef,
    setToolLog: toolEvents.setToolLog,
    dispatchTree,
    clearToolTimerRef,
  });

  // Scheduler hook
  const scheduler = useScheduler({ socket, sessionId });

  // Return the interface (pendingRestore removed)
  return {
    socket,
    connected,
    messages: streamingHook.messages,
    streaming: streamingHook.streaming,
    backgroundProcessing: streamingHook.backgroundProcessing,
    thinking: streamingHook.thinking,
    currentTool: toolEvents.currentTool,
    activityTree,
    usageStats: streamingHook.usageStats,
    toolLog: toolEvents.toolLog,
    sendMessage: actions.sendMessage,
    cancelQuery: actions.cancelQuery,
    pendingQuestion: toolEvents.pendingQuestion,
    respondToQuestion: actions.respondToQuestion,
    duplicateSession: actions.duplicateSession,
    isRestoringSession,
    signals: toolEvents.signals,
    promptSuggestions: toolEvents.promptSuggestions,
    rateLimitState: toolEvents.rateLimitState,
    contextTokens: streamingHook.contextTokens,
    todos: toolEvents.todos,
    setTodos: toolEvents.setTodos,
    scheduledTasks: scheduler.tasks,
    createScheduledTask: scheduler.createTask,
    deleteScheduledTask: scheduler.deleteTask,
    pauseScheduledTask: scheduler.pauseTask,
    resumeScheduledTask: scheduler.resumeTask,
  };
}

export type { UsageStats };
