import { useRef } from 'react';
import { Message, ToolEvent, ActivityNode, UsageStats, SignalState } from '../types';
import { useActivityTree } from './useActivityTree';
import { useSocketConnection } from './useSocketConnection';
import { useStreamingMessages } from './useStreamingMessages';
import { useToolEvents } from './useToolEvents';
import { useSessionRestore } from './useSessionRestore';
import { useSessionActions } from './useSessionActions';
import { useScheduler } from './useScheduler';

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

interface UseTabSocketProps {
  onDevServerDetected?: (url: string) => void;
}

export function useTabSocket(token: string | null, sessionId: string, props?: UseTabSocketProps) {
  const onDevServerDetected = props?.onDevServerDetected;
  // Session tracking refs
  const currentSessionIdRef = useRef<string>(sessionId);
  const prevSessionIdRef = useRef(sessionId);
  const sessionCacheRef = useRef<Map<string, SessionCache>>(new Map());
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
    socketRef,
    connected,
    connectedRef,
  } = useSocketConnection({ token, currentSessionIdRef });

  // Shared refs that need to exist before hooks
  const clearToolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolLogRef = useRef<ToolEvent[]>([]); // Create outside both hooks to break circular dependency

  // Streaming messages hook
  const streamingHook = useStreamingMessages({
    socket,
    toolLogRef,
    activityTreeRef,
    hasRunningAgents,
    isRestoringSessionRef: useRef(true), // Placeholder, will be overwritten by session restore
    currentSessionIdRef,
    sessionId,
  });

  // Tool events hook (uses streaming refs from streamingHook)
  const toolEvents = useToolEvents({
    socket,
    dispatchTree,
    currentSessionIdRef,
    streamingIdRef: streamingHook.streamingIdRef,
    streamingContentRef: streamingHook.streamingContentRef,
    setMessages: streamingHook.setMessages,
    setStreaming: streamingHook.setStreaming,
    sequenceRef,
    seenToolUseIds,
    toolLogRef, // Pass the shared ref
    onDevServerDetected,
  });

  // Session restore hook
  const { isRestoringSession, isRestoringSessionRef } = useSessionRestore({
    token,
    sessionId,
    socket,
    currentSessionIdRef,
    prevSessionIdRef,
    sessionCacheRef,
    messagesRef: streamingHook.messagesRef,
    streamingRef: streamingHook.streamingRef,
    backgroundProcessingRef: streamingHook.backgroundProcessingRef,
    thinkingRef: streamingHook.thinkingRef,
    streamingContentRef: streamingHook.streamingContentRef,
    streamingIdRef: streamingHook.streamingIdRef,
    toolLogRef, // Use the shared ref
    activityTreeRef,
    sequenceRef,
    seenToolUseIds,
    streamActiveRef: streamingHook.streamActiveRef,
    awaitingDeltaAfterRestore: streamingHook.awaitingDeltaAfterRestore,
    responseCompleteRef: streamingHook.responseCompleteRef,
    completionFinalizedRef: streamingHook.completionFinalizedRef,
    messageIndexRef: streamingHook.messageIndexRef,
    contextTokens: streamingHook.contextTokens,
    setMessages: streamingHook.setMessages,
    setStreaming: streamingHook.setStreaming,
    setBackgroundProcessing: streamingHook.setBackgroundProcessing,
    setThinking: streamingHook.setThinking,
    setToolLog: toolEvents.setToolLog,
    setCurrentTool: toolEvents.setCurrentTool,
    setPendingQuestion: toolEvents.setPendingQuestion,
    setPendingRestore: streamingHook.setPendingRestore,
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
    streamingIdRef: streamingHook.streamingIdRef,
    streamingContentRef: streamingHook.streamingContentRef,
    responseCompleteRef: streamingHook.responseCompleteRef,
    completionFinalizedRef: streamingHook.completionFinalizedRef,
    messageIndexRef: streamingHook.messageIndexRef,
    setMessages: streamingHook.setMessages,
    setStreaming: streamingHook.setStreaming,
    setBackgroundProcessing: streamingHook.setBackgroundProcessing,
    setThinking: streamingHook.setThinking,
    setCurrentTool: toolEvents.setCurrentTool,
    setPendingQuestion: toolEvents.setPendingQuestion,
    setPromptSuggestions: toolEvents.setPromptSuggestions,
    setSignals: toolEvents.setSignals,
    toolLogRef, // Use the shared ref
    setToolLog: toolEvents.setToolLog,
    dispatchTree,
    clearToolTimerRef,
  });

  // Scheduler hook
  const scheduler = useScheduler({ socket, sessionId });

  // Return the EXACT same interface as before
  return {
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
    pendingRestore: streamingHook.pendingRestore,
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
