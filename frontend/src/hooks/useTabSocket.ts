import { useEffect, useState, useCallback, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode, AgentNode, ToolNode, isAgentNode, UsageStats, SignalState } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'opus': 500_000,
  'sonnet': 500_000,
  'haiku': 200_000,
  'claude-sonnet-4-5-20250514': 500_000,
  'claude-opus-4-5-20250514': 500_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-20250514': 500_000,
  'claude-haiku-4-5-20251001': 200_000,
};
const DEFAULT_CONTEXT_WINDOW = 500_000;

const fetchUserStats = async (): Promise<UsageStats> => {
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

type TreeAction =
  | { type: 'AGENT_START'; event: ToolEvent; sequence: number }
  | { type: 'TOOL_START'; event: ToolEvent; sequence: number }
  | { type: 'TOOL_COMPLETE'; event: ToolEvent }
  | { type: 'AGENT_STOP'; event: ToolEvent }
  | { type: 'CLEAR' }
  | { type: 'LOAD_HISTORY'; events: ToolEvent[] }
  | { type: 'MARK_ALL_STOPPED' }
  | { type: 'TOOL_PROGRESS'; toolUseId: string; elapsedSeconds: number }
  | { type: 'SET_TREE'; tree: ActivityNode[] };

function findAndInsert(nodes: ActivityNode[], parentId: string, child: ActivityNode): ActivityNode[] {
  return nodes.map((node) => {
    if (isAgentNode(node) && node.tool_use_id === parentId) {
      return { ...node, children: [...node.children, child] };
    }
    if (isAgentNode(node)) {
      return { ...node, children: findAndInsert(node.children, parentId, child) };
    }
    return node;
  });
}

function findAndUpdate(
  nodes: ActivityNode[],
  toolUseId: string,
  updater: (node: ActivityNode) => ActivityNode
): ActivityNode[] {
  return nodes.map((node) => {
    if (node.tool_use_id === toolUseId) {
      return updater(node);
    }
    if (isAgentNode(node)) {
      return { ...node, children: findAndUpdate(node.children, toolUseId, updater) };
    }
    return node;
  });
}

function markRunningAsStopped(nodes: ActivityNode[]): ActivityNode[] {
  return nodes.map((node) => {
    const updated = node.status === 'running' ? { ...node, status: 'stopped' as const } : node;
    if (isAgentNode(updated)) {
      return { ...updated, children: markRunningAsStopped(updated.children) };
    }
    return updated;
  });
}


function treeReducer(state: ActivityNode[], action: TreeAction): ActivityNode[] {
  switch (action.type) {
    case 'AGENT_START': {
      const newAgent: AgentNode = {
        tool_use_id: action.event.tool_use_id,
        agent_type: action.event.agent_type || 'agent',
        tool_name: action.event.tool_name,
        description: action.event.description,
        timestamp: action.event.timestamp,
        children: [],
        status: 'running',
      };
      if (action.event.parent_agent_id) {
        return findAndInsert(state, action.event.parent_agent_id, newAgent);
      }
      return [...state, newAgent];
    }

    case 'TOOL_START': {
      const newTool: ToolNode = {
        tool_use_id: action.event.tool_use_id,
        tool_name: action.event.tool_name,
        timestamp: action.event.timestamp,
        status: 'running',
        parameters: action.event.parameters,
        parent_agent_id: action.event.parent_agent_id,
      };
      if (action.event.parent_agent_id) {
        return findAndInsert(state, action.event.parent_agent_id, newTool);
      }
      return [...state, newTool];
    }

    case 'TOOL_COMPLETE': {
      const isWorkerRestart = action.event.error === 'Worker restarted';
      return findAndUpdate(state, action.event.tool_use_id, (node) => ({
        ...node,
        status: (action.event.success === false && !isWorkerRestart) ? 'failed' : 'completed',
        duration_ms: action.event.duration_ms,
        error: isWorkerRestart ? undefined : action.event.error,
      }));
    }

    case 'AGENT_STOP': {
      const isWorkerRestart = action.event.error === 'Worker restarted';
      return findAndUpdate(state, action.event.tool_use_id, (node) => ({
        ...node,
        status: (action.event.error && !isWorkerRestart) ? 'failed' : 'completed',
        duration_ms: action.event.duration_ms,
        error: isWorkerRestart ? undefined : action.event.error,
        transcript_path: action.event.transcript_path,
        summary: action.event.summary,
      }));
    }

    case 'LOAD_HISTORY': {
      let newNodes: ActivityNode[] = [];
      let sequence = 0;

      for (const event of action.events) {
        if (event.type === 'agent_start') {
          const node: AgentNode = {
            tool_use_id: event.tool_use_id,
            agent_type: event.agent_type || 'agent',
            tool_name: event.tool_name,
            description: event.description,
            timestamp: event.timestamp,
            children: [],
            status: 'running',
            sequence: ++sequence,
          };
          if (event.parent_agent_id) {
            newNodes = findAndInsert(newNodes, event.parent_agent_id, node);
          } else {
            newNodes.push(node);
          }
        } else if (event.type === 'tool_start') {
          const node: ToolNode = {
            tool_use_id: event.tool_use_id,
            tool_name: event.tool_name,
            timestamp: event.timestamp,
            status: 'running',
            parameters: event.parameters,
            parent_agent_id: event.parent_agent_id,
            sequence: ++sequence,
          };
          if (event.parent_agent_id) {
            newNodes = findAndInsert(newNodes, event.parent_agent_id, node);
          } else {
            newNodes.push(node);
          }
        } else if (event.type === 'tool_complete' || event.type === 'agent_stop') {
          const isWorkerRestart = event.error === 'Worker restarted';
          newNodes = findAndUpdate(newNodes, event.tool_use_id, (node) => ({
            ...node,
            status: (event.success === false && !isWorkerRestart) ? 'failed' : 'completed',
            duration_ms: event.duration_ms,
            error: isWorkerRestart ? undefined : event.error,
            transcript_path: event.type === 'agent_stop' ? event.transcript_path : undefined,
            summary: event.type === 'agent_stop' ? event.summary : undefined,
          }));
        }
      }
      return newNodes;
    }

    case 'CLEAR':
      return [];

    case 'MARK_ALL_STOPPED':
      return markRunningAsStopped(state);

    case 'TOOL_PROGRESS': {
      return findAndUpdate(state, action.toolUseId, (node) => ({
        ...node,
        elapsed_seconds: action.elapsedSeconds,
      }));
    }

    default:
      return state;
  }
}

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

export function useTabSocket(token: string | null, sessionId: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const [thinking, setThinking] = useState<string>('');
  const [activityTree, dispatchTree] = useReducer(treeReducer, []);
  const activityTreeRef = useRef<ActivityNode[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats>({
    totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
    totalDuration: 0, queryCount: 0, contextWindowSize: DEFAULT_CONTEXT_WINDOW,
    model: '', linesOfCode: 0, totalSessions: 0,
  });
  const streamingContentRef = useRef('');
  const streamingIdRef = useRef<string | null>(null);
  const responseCompleteRef = useRef(false);
  const completionFinalizedRef = useRef(false);
  const syncInProgressRef = useRef(false);
  const sequenceRef = useRef(0);
  const currentSessionIdRef = useRef<string>(sessionId);
  const [currentTool, setCurrentTool] = useState<ToolEvent | null>(null);
  const toolLogRef = useRef<ToolEvent[]>([]);
  const [toolLog, setToolLog] = useState<ToolEvent[]>([]);
  const streamActiveRef = useRef(false);
  const clearToolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSessionIdRef = useRef(sessionId);
  const seenToolUseIds = useRef<Set<string>>(new Set());
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const pendingWorkerRestartErrorRef = useRef<{ message: string; timestamp: number } | null>(null);
  const workerRestartGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingDeltaAfterRestore = useRef(false);
  const [pendingRestore, setPendingRestore] = useState(false);
  const [signals, setSignals] = useState<SignalState>({ status: null });
  const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
  const [rateLimitState, setRateLimitState] = useState<{ active: boolean; retryAfterMs: number } | null>(null);
  const [contextTokens, setContextTokens] = useState<number | null>(null);

  // Session cache for preserving state during tab switches
  const sessionCacheRef = useRef<Map<string, SessionCache>>(new Map());
  // Keep messagesRef in sync with messages state for session-switch effect
  const messagesRef = useRef<Message[]>([]);

  // Fix 1: Refs to mirror state for cache saves (avoid stale closures)
  const streamingRef = useRef(false);
  const backgroundProcessingRef = useRef(false);
  const thinkingRef = useRef('');

  const setCurrentToolDebounced = (tool: ToolEvent | null) => {
    if (clearToolTimerRef.current) {
      clearTimeout(clearToolTimerRef.current);
      clearToolTimerRef.current = null;
    }
    if (tool !== null) {
      setCurrentTool(tool);
    } else {
      // Delay clearing to avoid flicker between rapid tool_complete → tool_start
      clearToolTimerRef.current = setTimeout(() => {
        setCurrentTool(null);
        clearToolTimerRef.current = null;
      }, 300);
    }
  };

  const checkAndFinalizeToolState = () => {
    // Check if we have a completed message that needs final tool log update
    if (!streamingIdRef.current && toolLogRef.current.length > 0) {
      const allToolsCompleted = toolLogRef.current.every(tool =>
        tool.type === 'tool_complete' || tool.type === 'agent_stop'
      );

      if (allToolsCompleted) {
        // Find the most recent message and update its toolLog with final states
        setMessages(prev => {
          const messages = [...prev];
          if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'assistant') {
              messages[messages.length - 1] = {
                ...lastMessage,
                toolLog: [...toolLogRef.current]
              };
            }
          }
          return messages;
        });

        // All tools completed, clear the tool log after a brief display period
        setTimeout(() => {
          toolLogRef.current = [];
          setToolLog([]);
          setBackgroundProcessing(false);
        }, 1500); // 1.5 second delay to show completion state
      }
    }
  };

  const clearPendingWorkerRestartError = () => {
    if (workerRestartGraceTimerRef.current) {
      clearTimeout(workerRestartGraceTimerRef.current);
      workerRestartGraceTimerRef.current = null;
    }
    pendingWorkerRestartErrorRef.current = null;
  };

  // Helper to check if there are any running agents in the activity tree
  const hasRunningAgents = useCallback((nodes: ActivityNode[]): boolean => {
    const checkNodes = (nodeList: ActivityNode[]): boolean => {
      for (const node of nodeList) {
        if (node.status === 'running') {
          return true;
        }
        if (isAgentNode(node) && checkNodes(node.children)) {
          return true;
        }
      }
      return false;
    };
    return checkNodes(nodes);
  }, []);

  const [pendingQuestion, setPendingQuestion] = useState<{
    questions: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
    }>;
    toolUseId: string;
} | null>(null);

  // Keep activityTreeRef in sync with activityTree
  useEffect(() => {
    activityTreeRef.current = activityTree;
  }, [activityTree]);

  // Keep messagesRef in sync with messages state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Fix 1: Sync refs with state for cache saves
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { backgroundProcessingRef.current = backgroundProcessing; }, [backgroundProcessing]);
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);

  // Fetch persisted stats from backend on mount
  useEffect(() => {
    fetchUserStats().then(setUsageStats);
  }, []);

  // Safety cleanup: Clear backgroundProcessing if no agents are running
  // This handles cases where final completion never arrives (error, cancel, disconnect)
  useEffect(() => {
    if (!backgroundProcessing || streaming) return;

    const cleanupTimer = setTimeout(() => {
      const hasRunning = hasRunningAgents(activityTree);
      if (!hasRunning && backgroundProcessing) {
        setBackgroundProcessing(false);
        toolLogRef.current = [];
        setToolLog([]);
      }
    }, 500); // Short delay to let final events arrive

    return () => clearTimeout(cleanupTimer);
  }, [backgroundProcessing, streaming, activityTree, hasRunningAgents]);

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      const previousSessionId = prevSessionIdRef.current;

      // Fix 1: Save current state to cache BEFORE resetting (if there are messages)
      // Use refs instead of state to avoid stale closure issues
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
      setMessages([]);
      dispatchTree({ type: 'CLEAR' });
      // Don't reset usage stats - they persist across sessions
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

      // Switch rooms on persistent socket (no destroy/recreate needed)
      if (socketRef.current?.connected) {
        if (previousSessionId) {
          socketRef.current.emit('leave_session', { session_id: previousSessionId });
        }
        socketRef.current.emit('join_session', { session_id: sessionId });
      }
    }
  }, [sessionId]);

  useEffect(() => {
    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      auth: { token },
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => {
      // Clear any pending disconnect timer - we reconnected in time
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setConnected(true);
      connectedRef.current = true;
      // Join the current session room
      const currentSession = currentSessionIdRef.current;
      if (currentSession) {
        newSocket.emit('join_session', { session_id: currentSession });
      }
    });
    newSocket.on('disconnect', () => {
      // Debounce setting connected to false to prevent flicker during reconnects
      disconnectTimerRef.current = setTimeout(() => {
        setConnected(false);
        connectedRef.current = false;
        disconnectTimerRef.current = null;
      }, 1500);
    });

    newSocket.io.on('reconnect', () => {
      // Clear any pending disconnect timer on explicit reconnect
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      const restoreAfterReconnect = async () => {
        try {
          const activeSessionId = currentSessionIdRef.current;
          if (!activeSessionId) return;

          let sessionIsActive = false;
          const historyRes = await fetch(`${SOCKET_URL}/api/history/${activeSessionId}`);
          if (historyRes.ok) {
            const { messages: dbMessages, streaming: isStreaming } = await historyRes.json();
            sessionIsActive = isStreaming || streamActiveRef.current;

            if (dbMessages && dbMessages.length > 0) {
              const restored: Message[] = dbMessages.map((m: any) => ({
                id: `db_${m.id}`,
                content: m.content,
                role: m.role as 'user' | 'assistant',
                timestamp: new Date(m.timestamp).getTime(),
              }));

              if (sessionIsActive) {
                streamActiveRef.current = false;
                const lastMsg = restored[restored.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  // Last message is assistant — resume streaming into it
                  streamingIdRef.current = lastMsg.id;
                  streamingContentRef.current = lastMsg.content || '';
                  setStreaming(true);
                  awaitingDeltaAfterRestore.current = true;
                  setPendingRestore(true);
                  setMessages(restored.map((m) =>
                    m.id === lastMsg.id ? { ...m, streaming: true } : m
                  ));
                } else {
                  // Last message is from user — response not saved yet
                  // Don't set streamingIdRef; text_delta will create a new message after the user's message
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
          if (activityRes.ok) {
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
              // Track loaded IDs to prevent duplicates from buffer replay
              toolEvents.forEach(e => {
                if (e.tool_use_id) seenToolUseIds.current.add(e.tool_use_id);
              });

              // Restore currentTool from any still-running tool/agent
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
                // Find the last tool that started but hasn't completed
                const lastRunning = [...toolEvents]
                  .reverse()
                  .find(e =>
                    (e.type === 'tool_start' || e.type === 'agent_start') &&
                    !completedIds.has(e.tool_use_id!)
                  );
                if (lastRunning) {
                  // Fix 3: Use direct setCurrentTool instead of debounced during restore
                  setCurrentTool(lastRunning);
                  // Fix 2: Set streaming=true when running tools detected during restore
                  setStreaming(true);
                }
              }
            }
          }
        } catch (err) {
        }
      };

      restoreAfterReconnect();
    });

    newSocket.on('message_received', () => {
      window.dispatchEvent(new CustomEvent('ccplus_message_received'));
    });

    newSocket.on('stream_active', (data?: { session_id?: string }) => {
      // Guard: Ignore events from old sessions
      if (data?.session_id && data.session_id !== currentSessionIdRef.current) {
        return;
      }
      streamActiveRef.current = true;
      setStreaming(true);
    });

    newSocket.on('stream_content_sync', (data: { content: string; session_id?: string }) => {
      // Guard: Ignore events from old sessions
      if (data.session_id && data.session_id !== currentSessionIdRef.current) {
        return;
      }
      // Server sent the full accumulated streaming content for this session
      // This catches us up on any text_delta events we missed during tab switch

      // Set flag to prevent duplicate content from text_delta during sync processing
      syncInProgressRef.current = true;
      streamingContentRef.current = data.content;

      if (!streamingIdRef.current) {
        // Create a new streaming message with the full content
        const msgId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        streamingIdRef.current = msgId;
        setStreaming(true);
        setMessages((prev) => {
          // Check if the last message is already a streaming assistant message
          const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.streaming) {
            // Update existing streaming message with full content
            streamingIdRef.current = lastMsg.id;
            return prev.map((m) =>
              m.id === lastMsg.id ? { ...m, content: data.content } : m
            );
          }
          // Create new message with full buffered content
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
        // Update existing streaming message with full content from server
        const msgId = streamingIdRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: data.content } : m
          )
        );
      }

      // Clear sync flag after state updates are queued
      syncInProgressRef.current = false;

      // Clear pending restore since we now have up-to-date content
      if (awaitingDeltaAfterRestore.current) {
        awaitingDeltaAfterRestore.current = false;
        setPendingRestore(false);
      }
    });

    newSocket.on('thinking_delta', (data: { text: string }) => {
      setThinking(prev => prev + data.text);
    });

    newSocket.on('text_delta', (data: { text: string; message_id?: string; session_id?: string }) => {
      // Guard: Ignore events from old sessions
      if (data.session_id && data.session_id !== currentSessionIdRef.current) {
        return;
      }

      // Skip deltas during sync to prevent duplicate content
      if (syncInProgressRef.current) {
        return;
      }

      // Clear the pending restore flag - we've received actual deltas
      if (awaitingDeltaAfterRestore.current) {
        awaitingDeltaAfterRestore.current = false;
        setPendingRestore(false);
      }

      // Clear any pending worker restart error - streaming has resumed
      clearPendingWorkerRestartError();

      // If we receive new text, we're actively streaming again
      setStreaming(true);
      setBackgroundProcessing(false);

      // If response_complete happened recently, append to finalized message
      if (responseCompleteRef.current && streamingIdRef.current) {
        const msgId = streamingIdRef.current;
        streamingContentRef.current += data.text;
        const currentContent = streamingContentRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: currentContent, streaming: true } : m
          )
        );
        return;
      }

      if (!streamingIdRef.current) {
        // Check if the last message is already a streaming assistant message
        // (can happen during tab switch when streamingIdRef was reset but streaming continues)
        setMessages((prev) => {
          const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.streaming) {
            // Resume the existing streaming message
            streamingIdRef.current = lastMsg.id;
            streamingContentRef.current = lastMsg.content + data.text;
            const updatedContent = streamingContentRef.current;
            return prev.map((m) =>
              m.id === lastMsg.id ? { ...m, content: updatedContent } : m
            );
          } else {
            // Create a new message for a genuinely new streaming sequence
            const msgId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
            streamingContentRef.current = data.text;
            streamingIdRef.current = msgId;
            setThinking('');
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
        // Append to existing streaming message
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

    newSocket.on('response_complete', (data: {
      message_id?: string;
      content?: string;
      cost?: number;
      duration_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      model?: string;
      sdk_session_id?: string | null;
      session_id?: string;
    }) => {
      // Guard: Ignore events from old sessions
      if (data.session_id && data.session_id !== currentSessionIdRef.current) {
        return;
      }
      const msgId = streamingIdRef.current;
      if (msgId) {
        // Finalize the current streaming message content, but keep tool state active
        // Use client-side accumulated content first to avoid visual jumps from re-parsing
        const finalContent = streamingContentRef.current || data.content || '';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: finalContent, streaming: false, toolLog: [...toolLogRef.current] } : m
          )
        );

        // Mark that we've finalized a message for this query cycle
        completionFinalizedRef.current = true;

        // Set flag to catch late text_deltas and keep streamingId alive briefly
        responseCompleteRef.current = true;

        // Reset streaming content state but keep streamingId for 100ms to catch late deltas
        streamingContentRef.current = '';

        // Clear flag and streamingId after a short delay
        setTimeout(() => {
          responseCompleteRef.current = false;
          streamingIdRef.current = null;
        }, 100);

        // Don't clear toolLogRef.current and toolLog here - wait for tools to complete
      }

      // Store the latest input_tokens as context usage indicator
      if (data.input_tokens !== undefined) {
        setContextTokens(data.input_tokens);
      }

      // Update context window size based on model
      if (data.model) {
        const windowSize = MODEL_CONTEXT_WINDOWS[data.model] || DEFAULT_CONTEXT_WINDOW;
        setUsageStats(prev => ({ ...prev, contextWindowSize: windowSize, model: data.model || prev.model }));
      }

      // Check if this is the final completion (has sdk_session_id) or an intermediate one
      const isFinalCompletion = data.sdk_session_id !== null && data.sdk_session_id !== undefined;

      if (isFinalCompletion) {
        // Final completion: re-fetch stats from backend to stay in sync
        fetchUserStats().then(stats => {
          setUsageStats(prev => ({
            ...stats,
            contextWindowSize: prev.contextWindowSize,
            model: prev.model || stats.model,
          }));
        });

        // End streaming session completely and clear background processing
        setStreaming(false);
        setBackgroundProcessing(false);
        setThinking('');
        if (clearToolTimerRef.current) {
          clearTimeout(clearToolTimerRef.current);
          clearToolTimerRef.current = null;
        }
        setCurrentTool(null);
        awaitingDeltaAfterRestore.current = false;
        setPendingRestore(false);

        // Clear tool log and signals only on final completion
        toolLogRef.current = [];
        setToolLog([]);
        setSignals({ status: null });
        // Don't clear prompt suggestions on final completion - they're meant to be used after

        // Delete cache entry for this session (data is now in DB)
        sessionCacheRef.current.delete(sessionId);

        // Reset completion flag for next query cycle
        completionFinalizedRef.current = false;
      } else {
        // Intermediate completion: main response is done, but check for background agents
        setStreaming(false);

        // Check if there are still running agents in the activity tree
        // Use a small delay to let the tree update with any final events
        setTimeout(() => {
          const hasRunning = hasRunningAgents(activityTreeRef.current);
          if (hasRunning) {
            setBackgroundProcessing(true);
          } else {
            // No running agents, safe to clear tool log after a brief delay for visual consistency
            setTimeout(() => {
              toolLogRef.current = [];
              setToolLog([]);
            }, 1000); // 1 second delay to let users see tool completion
          }
        }, 100);
      }

      if (!msgId && data.content && !completionFinalizedRef.current) {
        // Tab switch recovery: response_complete arrived but no streaming message exists
        // Create a finalized assistant message with the full content
        const recoveryId = `recovery_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        setMessages((prev) => {
          // Check if last message already has this content (avoid duplicates)
          const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === data.content) {
            return prev;
          }
          // Check if last assistant message is streaming and incomplete - update it
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

    newSocket.on('tool_event', (event: ToolEvent) => {
      // Guard: Ignore events from old sessions
      if (event.session_id && event.session_id !== currentSessionIdRef.current) {
        return;
      }
      // Deduplicate start events to prevent duplicate tree nodes after reconnect
      if ((event.type === 'tool_start' || event.type === 'agent_start') && event.tool_use_id) {
        if (seenToolUseIds.current.has(event.tool_use_id)) {
          return; // Already processed this start event
        }
        seenToolUseIds.current.add(event.tool_use_id);
      }

      switch (event.type) {
        case 'agent_start': {
          // Finalize the current streaming message before agent work begins
          if (streamingIdRef.current && streamingContentRef.current.trim()) {
            const msgId = streamingIdRef.current;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, streaming: false } : m
              )
            );
            streamingIdRef.current = null;
            streamingContentRef.current = '';
          }

          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'AGENT_START', event, sequence: seq });
          setCurrentToolDebounced(event);
          // Ensure streaming is true when agent work begins (shows thinking bubble)
          setStreaming(true);
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_start': {
          // Finalize the current streaming message before tool work begins
          if (streamingIdRef.current && streamingContentRef.current.trim()) {
            const msgId = streamingIdRef.current;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, streaming: false } : m
              )
            );
            streamingIdRef.current = null;
            streamingContentRef.current = '';
          }

          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'TOOL_START', event, sequence: seq });
          setCurrentToolDebounced(event);
          // Ensure streaming is true when tool work begins (shows thinking bubble)
          setStreaming(true);
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

          // Check if all tools have completed and update the final message
          setTimeout(() => {
            checkAndFinalizeToolState();
          }, 50); // Small delay to ensure all state updates are processed
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

          // Check if all tools have completed and update the final message
          setTimeout(() => {
            checkAndFinalizeToolState();
          }, 50); // Small delay to ensure all state updates are processed
          break;
      }
    });

    newSocket.on('error', (data: { message: string }) => {
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
      if (clearToolTimerRef.current) {
        clearTimeout(clearToolTimerRef.current);
        clearToolTimerRef.current = null;
      }
      setCurrentTool(null);
      setPendingQuestion(null);
      setSignals({ status: null });
    });

    newSocket.on('user_question', (data: { questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }>; tool_use_id: string }) => {
      setPendingQuestion({
        questions: data.questions,
        toolUseId: data.tool_use_id,
      });
    });

    newSocket.on('signal', (signal: { type: string; data: Record<string, unknown> }) => {
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

    newSocket.on('tool_progress', (data: { tool_use_id: string; elapsed_seconds: number }) => {
      // Update the activity tree node with elapsed time
      dispatchTree({ type: 'TOOL_PROGRESS', toolUseId: data.tool_use_id, elapsedSeconds: data.elapsed_seconds });
    });

    newSocket.on('rate_limit', (data: { retryAfterMs: number; rateLimitedAt: string }) => {
      setRateLimitState({ active: true, retryAfterMs: data.retryAfterMs });
      // Auto-clear rate limit state after the retry period
      setTimeout(() => {
        setRateLimitState(null);
      }, data.retryAfterMs);
    });

    newSocket.on('prompt_suggestions', (data: { suggestions: string[] }) => {
      setPromptSuggestions(data.suggestions);
    });

    newSocket.on('compact_boundary', () => {
      // Emit a system-level notification that context was compacted
      // We'll show this as a subtle divider in the chat
      setMessages(prev => [...prev, {
        id: `compact_${Date.now()}`,
        content: '↻ Context compacted',
        role: 'assistant' as const,
        timestamp: Date.now(),
        isCompactBoundary: true,
      }]);
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    return () => {
      if (clearToolTimerRef.current) {
        clearTimeout(clearToolTimerRef.current);
        clearToolTimerRef.current = null;
      }
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      socketRef.current = null;
      newSocket.close();
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const restoreSession = async () => {
      try {
        // Check if we have a cache entry for this session (more recent than DB)
        const cachedSession = sessionCacheRef.current.get(sessionId);
        let sessionIsActive = false;

        if (cachedSession) {
          // Restore messages and streaming state from cache
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

          // Fix 4: Cache deletion moved to finally block (after restore completes)
        } else {
          // No cache entry, restore messages from DB
          const historyRes = await fetch(`${SOCKET_URL}/api/history/${sessionId}`);
          if (historyRes.ok) {
            const data = await historyRes.json();
            const { messages: dbMessages, streaming: isStreaming, context_tokens, model } = data;
            // Use API streaming flag OR socket stream_active event (whichever arrived first)
            sessionIsActive = isStreaming || streamActiveRef.current;

            // Restore context tokens and model from DB
            if (context_tokens != null) {
              setContextTokens(context_tokens);
            }
            if (model) {
              const windowSize = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
              setUsageStats(prev => ({ ...prev, contextWindowSize: windowSize, model: model }));
            }

            if (dbMessages && dbMessages.length > 0) {
              const restored: Message[] = dbMessages.map((m: any) => ({
                id: `db_${m.id}`,
                content: m.content,
                role: m.role as 'user' | 'assistant',
                timestamp: new Date(m.timestamp).getTime(),
              }));

              if (sessionIsActive) {
                streamActiveRef.current = false;
                const lastMsg = restored[restored.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  // Last message is assistant — resume streaming into it
                  streamingIdRef.current = lastMsg.id;
                  streamingContentRef.current = lastMsg.content || '';
                  setStreaming(true);
                  awaitingDeltaAfterRestore.current = true;
                  setPendingRestore(true);
                  setMessages(restored.map((m) =>
                    m.id === lastMsg.id ? { ...m, streaming: true } : m
                  ));
                } else {
                  // Last message is from user — response not saved yet
                  // Don't set streamingIdRef; text_delta will create a new message after the user's message
                  setStreaming(true);
                  awaitingDeltaAfterRestore.current = true;
                  setPendingRestore(true);
                  setMessages(restored);
                }
              } else {
                setMessages(restored);
              }
            } else if (sessionIsActive) {
              // No messages in DB but session is active (very early in thinking)
              setStreaming(true);
            }
          }
        }

        // ALWAYS restore activity tree from DB (activity events are persisted in real-time)

        const activityRes = await fetch(`${SOCKET_URL}/api/activity/${sessionId}`);
        if (activityRes.ok) {
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
            // Track loaded IDs to prevent duplicates from buffer replay
            toolEvents.forEach(e => {
              if (e.tool_use_id) seenToolUseIds.current.add(e.tool_use_id);
            });

            // Restore currentTool from any still-running tool/agent
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
              // Find the last tool that started but hasn't completed
              const lastRunning = [...toolEvents]
                .reverse()
                .find(e =>
                  (e.type === 'tool_start' || e.type === 'agent_start') &&
                  !completedIds.has(e.tool_use_id!)
                );
              if (lastRunning) {
                // Fix 3: Use direct setCurrentTool instead of debounced during restore
                setCurrentTool(lastRunning);
                // Fix 2: Set streaming=true when running tools detected during restore
                setStreaming(true);
              }
            }
          }
        }
      } catch (err) {
      } finally {
        setIsRestoringSession(false);
        // Fix 4: Delete cache entry after restore completes
        sessionCacheRef.current.delete(sessionId);
      }
    };

    restoreSession();
  }, [token, sessionId]);

  const sendMessage = useCallback(
    (content: string, workspace?: string, model?: string, imageIds?: string[]) => {
      if (!socket || !connected) return;

      // Clear prompt suggestions when sending a new message
      setPromptSuggestions([]);

      // If background processing, cancel first
      if (backgroundProcessing) {
        socket.emit('cancel', { session_id: currentSessionIdRef.current });
        setBackgroundProcessing(false);
        dispatchTree({ type: 'MARK_ALL_STOPPED' });
      }

      // Finalize any currently streaming message before adding user message
      // This prevents streamed content from appearing above the sent message
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
    [socket, connected, backgroundProcessing]
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
  }, [socket, connected]);

  const respondToQuestion = useCallback(
    (response: Record<string, string>) => {
      if (!socket || !connected) return;
      socket.emit('question_response', { response, session_id: currentSessionIdRef.current });
      setPendingQuestion(null);
    },
    [socket, connected]
  );

  const duplicateSession = useCallback(
    (sourceSessionId: string, newSessionId: string) => {
      if (!socket || !connected) return;
      socket.emit('duplicate_session', { sourceSessionId, newSessionId });
    },
    [socket, connected]
  );

  return {
    connected,
    messages,
    streaming,
    backgroundProcessing,
    thinking,
    currentTool,
    activityTree,
    usageStats,
    toolLog,
    sendMessage,
    cancelQuery,
    pendingQuestion,
    respondToQuestion,
    duplicateSession,
    isRestoringSession,
    pendingRestore,
    signals,
    promptSuggestions,
    rateLimitState,
    contextTokens,
  };
}

export type { UsageStats };
