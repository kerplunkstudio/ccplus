import { useEffect, useState, useCallback, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode, AgentNode, ToolNode, isAgentNode, UsageStats } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';

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
  });
  const streamingContentRef = useRef('');
  const streamingIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const [sessionId, setSessionId] = useState(getSessionId);
  const [currentTool, setCurrentTool] = useState<ToolEvent | null>(null);

  useEffect(() => {
    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      query: { token, session_id: sessionId },
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));

    // Message received acknowledgment — notify that new session should be refreshed
    newSocket.on('message_received', () => {
      window.dispatchEvent(new CustomEvent('ccplus_message_received'));
    });

    // Streaming text deltas
    newSocket.on('text_delta', (data: { text: string; message_id?: string }) => {
      streamingContentRef.current += data.text;
      const currentContent = streamingContentRef.current;
      const msgId = streamingIdRef.current || `stream_${Date.now()}`;

      if (!streamingIdRef.current) {
        streamingIdRef.current = msgId;
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            content: currentContent,
            role: 'assistant',
            timestamp: Date.now(),
            streaming: true,
          },
        ]);
      } else {
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
    }) => {
      const msgId = streamingIdRef.current;
      if (msgId) {
        const finalContent = data.content || streamingContentRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: finalContent, streaming: false } : m
          )
        );
      }

      // Accumulate usage stats
      setUsageStats((prev) => ({
        totalCost: prev.totalCost + (data.cost || 0),
        totalInputTokens: prev.totalInputTokens + (data.input_tokens || 0),
        totalOutputTokens: prev.totalOutputTokens + (data.output_tokens || 0),
        totalDuration: prev.totalDuration + (data.duration_ms || 0),
        queryCount: prev.queryCount + 1,
      }));

      streamingContentRef.current = '';
      streamingIdRef.current = null;
      setStreaming(false);
      setCurrentTool(null);
    });

    // Tool/agent activity events
    newSocket.on('tool_event', (event: ToolEvent) => {
      switch (event.type) {
        case 'agent_start': {
          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'AGENT_START', event, sequence: seq });
          setCurrentTool(event);
          setMessages((prev) => [
            ...prev,
            {
              id: event.tool_use_id,
              role: 'assistant',
              timestamp: Date.now(),
              tool: {
                tool_name: event.tool_name,
                agent_type: event.agent_type,
                status: 'running',
              },
            },
          ]);
          break;
        }
        case 'tool_start': {
          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'TOOL_START', event, sequence: seq });
          setCurrentTool(event);
          setMessages((prev) => [
            ...prev,
            {
              id: event.tool_use_id,
              role: 'assistant',
              timestamp: Date.now(),
              tool: {
                tool_name: event.tool_name,
                parameters: event.parameters,
                status: 'running',
              },
            },
          ]);
          break;
        }
        case 'tool_complete':
          dispatchTree({ type: 'TOOL_COMPLETE', event });
          setCurrentTool(null);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.tool_use_id && m.tool
                ? {
                    ...m,
                    tool: {
                      ...m.tool,
                      status: event.success === false ? 'failed' : 'completed',
                      duration_ms: event.duration_ms,
                      error: event.error,
                    },
                  }
                : m
            )
          );
          break;
        case 'agent_stop':
          dispatchTree({ type: 'AGENT_STOP', event });
          setCurrentTool(null);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.tool_use_id && m.tool
                ? {
                    ...m,
                    tool: {
                      ...m.tool,
                      status: event.error ? 'failed' : 'completed',
                      duration_ms: event.duration_ms,
                      error: event.error,
                    },
                  }
                : m
            )
          );
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
            setMessages(restored);
          }
        }

        // Fetch activity events
        const activityRes = await fetch(`${SOCKET_URL}/api/activity/${sessionId}`);
        if (activityRes.ok) {
          const { events } = await activityRes.json();
          if (events && events.length > 0) {
            // Convert DB rows to ToolEvent format for the reducer
            const toolEvents: ToolEvent[] = events.map((e: any) => ({
              type: e.agent_type ? (e.success !== null ? 'agent_stop' : 'agent_start')
                   : (e.success !== null ? 'tool_complete' : 'tool_start'),
              tool_name: e.tool_name,
              tool_use_id: e.tool_use_id,
              parent_agent_id: e.parent_agent_id || null,
              agent_type: e.agent_type,
              timestamp: e.timestamp,
              success: e.success,
              error: e.error,
              duration_ms: e.duration_ms,
              parameters: e.parameters,
            }));
            dispatchTree({ type: 'LOAD_HISTORY', events: toolEvents });
          }
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
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
    sendMessage,
    cancelQuery,
    switchSession,
    newSession,
  };
}

export type { UsageStats };
