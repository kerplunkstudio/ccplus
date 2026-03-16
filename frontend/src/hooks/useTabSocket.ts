import { useEffect, useState, useCallback, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode, AgentNode, ToolNode, isAgentNode, UsageStats, SignalState, SignalStep } from '../types';

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
  | { type: 'TOOL_PROGRESS'; toolUseId: string; elapsedSeconds: number };

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
};

export function useTabSocket(token: string | null, sessionId: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
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
  const sequenceRef = useRef(0);
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
  const [signals, setSignals] = useState<SignalState>({ status: null, plan: null });
  const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
  const [rateLimitState, setRateLimitState] = useState<{ active: boolean; retryAfterMs: number } | null>(null);
  const [contextTokens, setContextTokens] = useState<number | null>(null);

  // Session cache for preserving state during tab switches
  const sessionCacheRef = useRef<Map<string, SessionCache>>(new Map());
  // Keep messagesRef in sync with messages state for session-switch effect
  const messagesRef = useRef<Message[]>([]);

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

  // Fetch persisted stats from backend on mount
  useEffect(() => {
    fetchUserStats().then(setUsageStats);
  }, []);

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
          streaming: streaming,
          backgroundProcessing: backgroundProcessing,
          thinking: thinking,
        });
      }

      prevSessionIdRef.current = sessionId;
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
      setSignals({ status: null, plan: null });
    }
  }, [sessionId, streaming, backgroundProcessing, thinking]);

  useEffect(() => {
    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      query: { token, session_id: sessionId },
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => {
      // Clear any pending disconnect timer - we reconnected in time
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setConnected(true);
    });
    newSocket.on('disconnect', () => {
      // Debounce setting connected to false to prevent flicker during tab switches
      disconnectTimerRef.current = setTimeout(() => {
        setConnected(false);
        disconnectTimerRef.current = null;
      }, 1500);
      if (streamingIdRef.current) {
        const msgId = streamingIdRef.current;
        const finalContent = streamingContentRef.current;
        if (finalContent) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, content: finalContent, streaming: false } : m
            )
          );
        }
        streamingContentRef.current = '';
        streamingIdRef.current = null;
        setStreaming(false);
        if (clearToolTimerRef.current) {
          clearTimeout(clearToolTimerRef.current);
          clearToolTimerRef.current = null;
        }
        setCurrentTool(null);
      }
    });

    newSocket.io.on('reconnect', () => {
      // Clear any pending disconnect timer on explicit reconnect
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      const restoreAfterReconnect = async () => {
        try {
          let sessionIsActive = false;
          const historyRes = await fetch(`${SOCKET_URL}/api/history/${sessionId}`);
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
                  setCurrentToolDebounced(lastRunning);
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

    newSocket.on('stream_active', () => {
      streamActiveRef.current = true;
      setStreaming(true);
    });

    newSocket.on('thinking_delta', (data: { text: string }) => {
      setThinking(prev => prev + data.text);
    });

    newSocket.on('text_delta', (data: { text: string; message_id?: string }) => {
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

      if (!streamingIdRef.current) {
        // Create a new message for each new streaming sequence
        // This ensures consecutive Claude responses appear as separate messages
        const msgId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        streamingContentRef.current = data.text;
        streamingIdRef.current = msgId;
        setThinking('');
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            content: data.text,
            role: 'assistant' as const,
            timestamp: Date.now(),
            streaming: true,
          },
        ]);
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
    }) => {
      const msgId = streamingIdRef.current;
      if (msgId) {
        // Finalize the current streaming message content, but keep tool state active
        const finalContent = data.content || streamingContentRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: finalContent, streaming: false, toolLog: [...toolLogRef.current] } : m
          )
        );

        // Reset streaming content state but keep tool state until tools complete
        streamingContentRef.current = '';
        streamingIdRef.current = null;
        // Don't clear toolLogRef.current and toolLog here - wait for tools to complete
      }

      // Store the latest input_tokens as context usage indicator
      if (data.input_tokens !== undefined) {
        setContextTokens(data.input_tokens);
      }

      // Check if this is the final completion (has sdk_session_id) or an intermediate one
      const isFinalCompletion = data.sdk_session_id !== null && data.sdk_session_id !== undefined;

      if (isFinalCompletion) {
        // Final completion: re-fetch stats from backend to stay in sync
        fetchUserStats().then(setUsageStats);

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
        setSignals({ status: null, plan: null });
        // Don't clear prompt suggestions on final completion - they're meant to be used after

        // Delete cache entry for this session (data is now in DB)
        sessionCacheRef.current.delete(sessionId);
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
    });

    newSocket.on('tool_event', (event: ToolEvent) => {
      // Deduplicate start events to prevent duplicate tree nodes after reconnect
      if ((event.type === 'tool_start' || event.type === 'agent_start') && event.tool_use_id) {
        if (seenToolUseIds.current.has(event.tool_use_id)) {
          return; // Already processed this start event
        }
        seenToolUseIds.current.add(event.tool_use_id);
      }

      switch (event.type) {
        case 'agent_start': {
          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'AGENT_START', event, sequence: seq });
          setCurrentToolDebounced(event);
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_start': {
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
      if (clearToolTimerRef.current) {
        clearTimeout(clearToolTimerRef.current);
        clearToolTimerRef.current = null;
      }
      setCurrentTool(null);
      setPendingQuestion(null);
      setSignals({ status: null, plan: null });
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
          setSignals(prev => ({
            ...prev,
            status: {
              phase: signal.data.phase as SignalState['status'] extends null ? never : NonNullable<SignalState['status']>['phase'],
              detail: signal.data.detail as string | undefined,
            },
          }));
          break;
        case 'plan':
          setSignals(prev => ({
            ...prev,
            plan: (signal.data.steps as Array<{ label: string; status?: string }>).map(s => ({
              label: s.label,
              status: (s.status || 'pending') as SignalStep['status'],
            })),
          }));
          break;
        case 'progress': {
          const stepIndex = signal.data.stepIndex as number;
          const status = signal.data.status as NonNullable<SignalStep['status']>;
          setSignals(prev => {
            if (!prev.plan) return prev;
            const updatedPlan = prev.plan.map((step, i) =>
              i === stepIndex ? { ...step, status } : step
            );
            return { ...prev, plan: updatedPlan };
          });
          break;
        }
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

    return () => {
      if (clearToolTimerRef.current) {
        clearTimeout(clearToolTimerRef.current);
        clearToolTimerRef.current = null;
      }
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      newSocket.close();
    };
  }, [token, sessionId]);

  useEffect(() => {
    if (!token) return;

    const restoreSession = async () => {
      try {
        // Check if we have a cache entry for this session (more recent than DB)
        const cachedSession = sessionCacheRef.current.get(sessionId);
        if (cachedSession) {
          // Restore from cache (has more recent data than DB during streaming)
          setMessages(cachedSession.messages);
          streamingContentRef.current = cachedSession.streamingContent;
          streamingIdRef.current = cachedSession.streamingId;
          toolLogRef.current = cachedSession.toolLog;
          setToolLog(cachedSession.toolLog);
          dispatchTree({ type: 'LOAD_HISTORY', events: cachedSession.toolLog });
          sequenceRef.current = cachedSession.sequenceCounter;
          seenToolUseIds.current = cachedSession.seenIds;
          setStreaming(cachedSession.streaming);
          setBackgroundProcessing(cachedSession.backgroundProcessing);
          setThinking(cachedSession.thinking);

          // Delete cache entry after restoring (data is now in current state)
          sessionCacheRef.current.delete(sessionId);
          setIsRestoringSession(false);
          return;
        }

        // No cache entry, restore from DB
        let sessionIsActive = false;
        const historyRes = await fetch(`${SOCKET_URL}/api/history/${sessionId}`);
        if (historyRes.ok) {
          const { messages: dbMessages, streaming: isStreaming } = await historyRes.json();
          // Use API streaming flag OR socket stream_active event (whichever arrived first)
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
            // No messages in DB but session is active (very early in thinking)
            setStreaming(true);
          }
        }

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
                setCurrentToolDebounced(lastRunning);
              }
            }
          }
        }
      } catch (err) {
      } finally {
        setIsRestoringSession(false);
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
        socket.emit('cancel');
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
      setSignals({ status: null, plan: null });
      socket.emit('message', { content, workspace, model, image_ids: imageIds });
    },
    [socket, connected, backgroundProcessing]
  );

  const cancelQuery = useCallback(() => {
    if (!socket || !connected) return;
    socket.emit('cancel');

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
    setStreaming(false);
    setBackgroundProcessing(false);
    if (clearToolTimerRef.current) {
      clearTimeout(clearToolTimerRef.current);
      clearToolTimerRef.current = null;
    }
    setCurrentTool(null);
    setPendingQuestion(null);
    setSignals({ status: null, plan: null });
  }, [socket, connected]);

  const respondToQuestion = useCallback(
    (response: Record<string, string>) => {
      if (!socket || !connected) return;
      socket.emit('question_response', { response });
      setPendingQuestion(null);
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
    isRestoringSession,
    pendingRestore,
    signals,
    promptSuggestions,
    rateLimitState,
    contextTokens,
  };
}

export type { UsageStats };
