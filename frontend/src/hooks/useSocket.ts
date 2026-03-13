import { useEffect, useState, useCallback, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode, AgentNode, ToolNode, isAgentNode, UsageStats } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'opus': 200_000,
  'sonnet': 200_000,
  'haiku': 200_000,
  'claude-sonnet-4-5-20250514': 200_000,
  'claude-opus-4-5-20250514': 200_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;

const getSessionId = (): string => {
  let sessionId = localStorage.getItem('ccplus_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('ccplus_session_id', sessionId);
  }
  return sessionId;
};

// --- Activity Tree Reducer ---

type TreeAction =
  | { type: 'AGENT_START'; event: ToolEvent; sequence: number }
  | { type: 'TOOL_START'; event: ToolEvent; sequence: number }
  | { type: 'TOOL_COMPLETE'; event: ToolEvent }
  | { type: 'AGENT_STOP'; event: ToolEvent }
  | { type: 'CLEAR' }
  | { type: 'LOAD_HISTORY'; events: ToolEvent[] };

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
      return findAndUpdate(state, action.event.tool_use_id, (node) => ({
        ...node,
        status: action.event.success === false ? 'failed' : 'completed',
        duration_ms: action.event.duration_ms,
        error: action.event.error,
      }));
    }

    case 'AGENT_STOP': {
      return findAndUpdate(state, action.event.tool_use_id, (node) => ({
        ...node,
        status: action.event.error ? 'failed' : 'completed',
        duration_ms: action.event.duration_ms,
        error: action.event.error,
      }));
    }

    case 'LOAD_HISTORY': {
      // Reconstruct the activity tree from stored events
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
          newNodes = findAndUpdate(newNodes, event.tool_use_id, (node) => ({
            ...node,
            status: event.success === false ? 'failed' : 'completed',
            duration_ms: event.duration_ms,
            error: event.error,
          }));
        }
      }
      return newNodes;
    }

    case 'CLEAR':
      return [];

    default:
      return state;
  }
}

export function useSocket(token: string | null) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activityTree, dispatchTree] = useReducer(treeReducer, []);
  const [usageStats, setUsageStats] = useState<UsageStats>({
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDuration: 0,
    queryCount: 0,
    contextWindowSize: DEFAULT_CONTEXT_WINDOW,
    model: '',
  });
  const streamingContentRef = useRef('');
  const streamingIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const [sessionId, setSessionId] = useState(getSessionId);
  const [currentTool, setCurrentTool] = useState<ToolEvent | null>(null);
  const toolLogRef = useRef<ToolEvent[]>([]);
  const [toolLog, setToolLog] = useState<ToolEvent[]>([]);
  // Tracks whether this session has an active stream (set by server on connect)
  const streamActiveRef = useRef(false);

  useEffect(() => {
    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      query: { token, session_id: sessionId },
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => {
      setConnected(false);
      // If we were streaming when the server went down, finalize the message
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
        setCurrentTool(null);
      }
    });

    newSocket.io.on('reconnect', () => {
      // Re-fetch conversation history and activity tree after server restart
      const restoreAfterReconnect = async () => {
        try {
          const historyRes = await fetch(`${SOCKET_URL}/api/history/${sessionId}`);
          if (historyRes.ok) {
            const { messages: dbMessages } = await historyRes.json();
            if (dbMessages && dbMessages.length > 0) {
              const restored: Message[] = dbMessages.map((m: any) => ({
                id: `db_${m.id}`,
                content: m.content,
                role: m.role as 'user' | 'assistant',
                timestamp: new Date(m.timestamp).getTime(),
              }));

              // If stream_active was received, set up streaming from last assistant msg
              if (streamActiveRef.current) {
                streamActiveRef.current = false;
                const lastAssistant = [...restored].reverse().find((m) => m.role === 'assistant');
                if (lastAssistant) {
                  streamingIdRef.current = lastAssistant.id;
                  streamingContentRef.current = lastAssistant.content || '';
                  setStreaming(true);
                  setMessages(restored.map((m) =>
                    m.id === lastAssistant.id ? { ...m, streaming: true } : m
                  ));
                } else {
                  setMessages(restored);
                }
              } else {
                setMessages(restored);
              }
            }
          }

          const activityRes = await fetch(`${SOCKET_URL}/api/activity/${sessionId}`);
          if (activityRes.ok) {
            const { events } = await activityRes.json();
            if (events && events.length > 0) {
              const toolEvents: ToolEvent[] = [];
              for (const e of events) {
                const isAgent = !!e.agent_type;
                // Always emit start event first
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
                // If completed, also emit complete event
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
            }
          }
        } catch (err) {
          // Server may still be starting up, socket.io will retry
        }
      };

      restoreAfterReconnect();
    });

    // Message received acknowledgment — notify that new session should be refreshed
    newSocket.on('message_received', () => {
      window.dispatchEvent(new CustomEvent('ccplus_message_received'));
    });

    // Server tells us this session has an active stream (e.g., after session switch)
    newSocket.on('stream_active', () => {
      streamActiveRef.current = true;
      setStreaming(true);
    });

    // Streaming text deltas
    newSocket.on('text_delta', (data: { text: string; message_id?: string }) => {
      if (!streamingIdRef.current) {
        // Starting fresh or resuming after session switch.
        // Check if the last message is an existing assistant message (from DB restore)
        // and continue from it rather than creating a duplicate.
        setMessages((prev) => {
          const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
          if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.streaming) {
            // Resume from DB-restored assistant message
            streamingContentRef.current = lastMsg.content + data.text;
            streamingIdRef.current = lastMsg.id;
            return prev.map((m) =>
              m.id === lastMsg.id
                ? { ...m, content: streamingContentRef.current, streaming: true }
                : m
            );
          }
          // No existing assistant message to resume from — create new
          const msgId = `stream_${Date.now()}`;
          streamingContentRef.current = data.text;
          streamingIdRef.current = msgId;
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
      setStreaming(true);
    });

    // Response complete — finalize streaming message
    newSocket.on('response_complete', (data: {
      message_id?: string;
      content?: string;
      cost?: number;
      duration_ms?: number;
      input_tokens?: number;
      output_tokens?: number;
      model?: string;
    }) => {
      const msgId = streamingIdRef.current;
      if (msgId) {
        const finalContent = data.content || streamingContentRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: finalContent, streaming: false, toolLog: [...toolLogRef.current] } : m
          )
        );
      }

      // Accumulate usage stats
      const model = data.model || '';
      const contextWindowSize = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;

      setUsageStats((prev) => ({
        totalCost: prev.totalCost + (data.cost || 0),
        totalInputTokens: prev.totalInputTokens + (data.input_tokens || 0),
        totalOutputTokens: prev.totalOutputTokens + (data.output_tokens || 0),
        totalDuration: prev.totalDuration + (data.duration_ms || 0),
        queryCount: prev.queryCount + 1,
        contextWindowSize,
        model,
      }));

      streamingContentRef.current = '';
      streamingIdRef.current = null;
      setStreaming(false);
      setCurrentTool(null);
      toolLogRef.current = [];
      setToolLog([]);
    });

    // Tool/agent activity events
    newSocket.on('tool_event', (event: ToolEvent) => {
      switch (event.type) {
        case 'agent_start': {
          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'AGENT_START', event, sequence: seq });
          setCurrentTool(event);
          // Add to tool log
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_start': {
          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'TOOL_START', event, sequence: seq });
          setCurrentTool(event);
          // Add to tool log
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_complete':
          dispatchTree({ type: 'TOOL_COMPLETE', event });
          setCurrentTool(null);
          // Update existing entry in tool log
          toolLogRef.current = toolLogRef.current.map((t) =>
            t.tool_use_id === event.tool_use_id
              ? { ...t, success: event.success, duration_ms: event.duration_ms, error: event.error, type: event.type }
              : t
          );
          setToolLog([...toolLogRef.current]);
          break;
        case 'agent_stop':
          dispatchTree({ type: 'AGENT_STOP', event });
          setCurrentTool(null);
          // Update existing entry in tool log
          toolLogRef.current = toolLogRef.current.map((t) =>
            t.tool_use_id === event.tool_use_id
              ? { ...t, success: event.success, duration_ms: event.duration_ms, error: event.error, type: event.type }
              : t
          );
          setToolLog([...toolLogRef.current]);
          break;
      }
    });

    // Error events
    newSocket.on('error', (data: { message: string }) => {
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        content: `Error: ${data.message}`,
        role: 'assistant',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStreaming(false);
      streamingContentRef.current = '';
      streamingIdRef.current = null;
      setCurrentTool(null);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token, sessionId]);

  // Restore session data from backend on mount
  useEffect(() => {
    if (!token) return;

    const restoreSession = async () => {
      try {
        // Fetch conversation history
        const historyRes = await fetch(`${SOCKET_URL}/api/history/${sessionId}`);
        if (historyRes.ok) {
          const { messages: dbMessages } = await historyRes.json();
          if (dbMessages && dbMessages.length > 0) {
            const restored: Message[] = dbMessages.map((m: any) => ({
              id: `db_${m.id}`,
              content: m.content,
              role: m.role as 'user' | 'assistant',
              timestamp: new Date(m.timestamp).getTime(),
            }));

            // If stream_active was received before restore completed,
            // set up streaming state from the last assistant message
            if (streamActiveRef.current) {
              streamActiveRef.current = false;
              const lastAssistant = [...restored].reverse().find((m) => m.role === 'assistant');
              if (lastAssistant) {
                streamingIdRef.current = lastAssistant.id;
                streamingContentRef.current = lastAssistant.content || '';
                setStreaming(true);
                setMessages(restored.map((m) =>
                  m.id === lastAssistant.id ? { ...m, streaming: true } : m
                ));
              } else {
                setMessages(restored);
              }
            } else {
              setMessages(restored);
            }
          }
        }

        // Fetch activity events
        const activityRes = await fetch(`${SOCKET_URL}/api/activity/${sessionId}`);
        if (activityRes.ok) {
          const { events } = await activityRes.json();
          if (events && events.length > 0) {
            // Convert DB rows to ToolEvent format for the reducer
            const toolEvents: ToolEvent[] = [];
            for (const e of events) {
              const isAgent = !!e.agent_type;
              // Always emit start event first
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
              // If completed, also emit complete event
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
          }
        }
      } catch (err) {
        // Restore failed silently — new session will start
      }
    };

    restoreSession();
  }, [token, sessionId]);

  const sendMessage = useCallback(
    (content: string, workspace?: string, model?: string) => {
      if (!socket || !connected) return;

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
      socket.emit('message', { content, workspace, model });
    },
    [socket, connected]
  );

  const cancelQuery = useCallback(() => {
    if (!socket || !connected) return;
    socket.emit('cancel');

    // Finalize any in-progress stream
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
    setCurrentTool(null);
  }, [socket, connected]);

  const resetStreamingState = useCallback(() => {
    setStreaming(false);
    streamingContentRef.current = '';
    streamingIdRef.current = null;
    streamActiveRef.current = false;
    setCurrentTool(null);
  }, []);

  const switchSession = useCallback(
    (newSessionId: string) => {
      localStorage.setItem('ccplus_session_id', newSessionId);
      setSessionId(newSessionId);
      setMessages([]);
      dispatchTree({ type: 'CLEAR' });
      resetStreamingState();
      setUsageStats({
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDuration: 0,
        queryCount: 0,
        contextWindowSize: DEFAULT_CONTEXT_WINDOW,
        model: '',
      });
    },
    [resetStreamingState]
  );

  const newSession = useCallback(() => {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('ccplus_session_id', id);
    setSessionId(id);
    setMessages([]);
    dispatchTree({ type: 'CLEAR' });
    resetStreamingState();
    setUsageStats({
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDuration: 0,
      queryCount: 0,
      contextWindowSize: DEFAULT_CONTEXT_WINDOW,
      model: '',
    });
  }, [resetStreamingState]);

  return {
    connected,
    messages,
    streaming,
    currentTool,
    activityTree,
    usageStats,
    sessionId,
    toolLog,
    sendMessage,
    cancelQuery,
    switchSession,
    newSession,
  };
}

export type { UsageStats };
