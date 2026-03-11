import { useEffect, useState, useCallback, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, ToolEvent, ActivityNode, AgentNode, ToolNode, isAgentNode } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';

const getSessionId = (): string => {
  let sessionId = sessionStorage.getItem('ccplus_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('ccplus_session_id', sessionId);
  }
  return sessionId;
};

// --- Activity Tree Reducer ---

type TreeAction =
  | { type: 'AGENT_START'; event: ToolEvent }
  | { type: 'TOOL_START'; event: ToolEvent }
  | { type: 'TOOL_COMPLETE'; event: ToolEvent }
  | { type: 'AGENT_STOP'; event: ToolEvent }
  | { type: 'CLEAR' };

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
  const streamingContentRef = useRef('');
  const streamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const sessionId = getSessionId();
    const newSocket = io(SOCKET_URL, {
      query: { token, session_id: sessionId },
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));

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
    newSocket.on('response_complete', (data: { message_id?: string; content?: string }) => {
      const msgId = streamingIdRef.current;
      if (msgId) {
        const finalContent = data.content || streamingContentRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: finalContent, streaming: false } : m
          )
        );
      }
      streamingContentRef.current = '';
      streamingIdRef.current = null;
      setStreaming(false);
    });

    // Tool/agent activity events
    newSocket.on('tool_event', (event: ToolEvent) => {
      switch (event.type) {
        case 'agent_start':
          dispatchTree({ type: 'AGENT_START', event });
          break;
        case 'tool_start':
          dispatchTree({ type: 'TOOL_START', event });
          break;
        case 'tool_complete':
          dispatchTree({ type: 'TOOL_COMPLETE', event });
          break;
        case 'agent_stop':
          dispatchTree({ type: 'AGENT_STOP', event });
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
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!socket || !connected) return;

      const userMessage: Message = {
        id: `user_${Date.now()}`,
        content,
        role: 'user',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      dispatchTree({ type: 'CLEAR' });
      socket.emit('message', { content });
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
  }, [socket, connected]);

  return {
    connected,
    messages,
    streaming,
    activityTree,
    sendMessage,
    cancelQuery,
  };
}
