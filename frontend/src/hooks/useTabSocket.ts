import { useEffect, useState, useCallback, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode, AgentNode, ToolNode, isAgentNode, UsageStats } from '../types';

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

const INITIAL_USAGE_STATS: UsageStats = {
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalDuration: 0,
  queryCount: 0,
  contextWindowSize: DEFAULT_CONTEXT_WINDOW,
  model: '',
  linesOfCode: 0,
  totalSessions: 1,
};

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

export function useTabSocket(token: string | null, sessionId: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activityTree, dispatchTree] = useReducer(treeReducer, []);
  const [usageStats, setUsageStats] = useState<UsageStats>(INITIAL_USAGE_STATS);
  const streamingContentRef = useRef('');
  const streamingIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const [currentTool, setCurrentTool] = useState<ToolEvent | null>(null);
  const toolLogRef = useRef<ToolEvent[]>([]);
  const [toolLog, setToolLog] = useState<ToolEvent[]>([]);
  const streamActiveRef = useRef(false);
  const prevSessionIdRef = useRef(sessionId);
  const seenToolUseIds = useRef<Set<string>>(new Set());
  const [pendingQuestion, setPendingQuestion] = useState<{
    questions: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
    }>;
    toolUseId: string;
} | null>(null);

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      setMessages([]);
      dispatchTree({ type: 'CLEAR' });
      setUsageStats(INITIAL_USAGE_STATS);
      setStreaming(false);
      setCurrentTool(null);
      toolLogRef.current = [];
      setToolLog([]);
      streamingContentRef.current = '';
      streamingIdRef.current = null;
      streamActiveRef.current = false;
      sequenceRef.current = 0;
      seenToolUseIds.current.clear();
      setPendingQuestion(null);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      query: { token, session_id: sessionId },
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => {
      setConnected(false);
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

    newSocket.on('text_delta', (data: { text: string; message_id?: string }) => {
      if (!streamingIdRef.current) {
        // Always create a new message for each new Claude response
        // Don't append to existing assistant messages to ensure proper separation
        const msgId = `stream_${Date.now()}`;
        streamingContentRef.current = data.text;
        streamingIdRef.current = msgId;
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

      const model = data.model || '';
      const contextWindowSize = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
      const inputTokens = data.input_tokens || 0;
      const outputTokens = data.output_tokens || 0;

      setUsageStats((prev) => ({
        totalCost: prev.totalCost + (data.cost || 0),
        totalInputTokens: prev.totalInputTokens + inputTokens,
        totalOutputTokens: prev.totalOutputTokens + outputTokens,
        totalDuration: prev.totalDuration + (data.duration_ms || 0),
        queryCount: prev.queryCount + 1,
        contextWindowSize,
        model,
        linesOfCode: prev.linesOfCode,
        totalSessions: prev.totalSessions,
      }));

      streamingContentRef.current = '';
      streamingIdRef.current = null;
      setStreaming(false);
      setCurrentTool(null);
      toolLogRef.current = [];
      setToolLog([]);
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
          setCurrentTool(event);
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_start': {
          const seq = ++sequenceRef.current;
          dispatchTree({ type: 'TOOL_START', event, sequence: seq });
          setCurrentTool(event);
          const newEntry = { ...event };
          toolLogRef.current = [...toolLogRef.current, newEntry];
          setToolLog([...toolLogRef.current]);
          break;
        }
        case 'tool_complete': {
          dispatchTree({ type: 'TOOL_COMPLETE', event });
          setCurrentTool(null);
          toolLogRef.current = toolLogRef.current.map((t) =>
            t.tool_use_id === event.tool_use_id
              ? { ...t, success: event.success, duration_ms: event.duration_ms, error: event.error, type: event.type }
              : t
          );
          setToolLog([...toolLogRef.current]);

          // Track lines of code from Write and Edit tools
          if (event.tool_name === 'Write' || event.tool_name === 'Edit') {
            const params = event.parameters as { content?: string; new_string?: string } | undefined;
            const content = params?.content || params?.new_string || '';
            const lines = content.split('\n').length;
            setUsageStats((prev) => ({
              ...prev,
              linesOfCode: prev.linesOfCode + lines,
            }));
          }
          break;
        }
        case 'agent_stop':
          dispatchTree({ type: 'AGENT_STOP', event });
          setCurrentTool(null);
          toolLogRef.current = toolLogRef.current.map((t) =>
            t.tool_use_id === event.tool_use_id
              ? { ...t, success: event.success, duration_ms: event.duration_ms, error: event.error, type: event.type }
              : t
          );
          setToolLog([...toolLogRef.current]);
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
      streamingContentRef.current = '';
      streamingIdRef.current = null;
      setCurrentTool(null);
    });

    newSocket.on('user_question', (data: { questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }>; tool_use_id: string }) => {
      setPendingQuestion({
        questions: data.questions,
        toolUseId: data.tool_use_id,
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token, sessionId]);

  useEffect(() => {
    if (!token) return;

    const restoreSession = async () => {
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
          }
        }
      } catch (err) {
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

  const respondToQuestion = useCallback(
    (response: string) => {
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
    currentTool,
    activityTree,
    usageStats,
    toolLog,
    sendMessage,
    cancelQuery,
    pendingQuestion,
    respondToQuestion,
  };
}

export type { UsageStats };
