import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { Message, ImageAttachment } from '../types';
import { InteractiveMessage } from '../types/interactive';
import { SOCKET_URL } from '../config';
const STORAGE_KEY = 'ccplus_captain_messages';
const ARCHIVE_KEY = 'ccplus_captain_archive';
const MAX_ARCHIVED = 20;

const TOOL_LABELS: Record<string, string> = {
  'mcp__memory__memory_search': 'Searching memory...',
  'mcp__fleet-control__start_session': 'Starting session...',
  'mcp__fleet-control__list_sessions': 'Checking fleet...',
  'mcp__fleet-control__get_session_state': 'Checking session...',
  'mcp__fleet-control__request_user_input': 'Waiting for input...',
  'mcp__fleet-control__cancel_session': 'Cancelling session...',
};
const DEFAULT_TOOL_LABEL = 'Working...';
const SAFETY_TIMEOUT_MS = 90_000;

export interface CaptainConversation {
  id: string;
  messages: Message[];
  startedAt: number;
  endedAt: number;
}

function loadMessages(): Message[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: Message[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {
    // Storage full or unavailable
  }
}

function loadArchive(): CaptainConversation[] {
  try {
    const stored = localStorage.getItem(ARCHIVE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveArchive(conversations: CaptainConversation[]): void {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(conversations));
  } catch {
    // Storage full or unavailable
  }
}

export function useCaptainSocket(socket: Socket | null) {
  const [captainSessionId, setCaptainSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [archivedConversations, setArchivedConversations] = useState<CaptainConversation[]>(loadArchive);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isModelThinking, setIsModelThinking] = useState(false);
  const [interactiveMessages, setInteractiveMessages] = useState<InteractiveMessage[]>([]);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [contextPct, setContextPct] = useState(0);
  const currentSessionIdRef = useRef<string>('');
  const messageIndexRef = useRef<number>(-1);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize Captain session on mount and load messages from DB
  useEffect(() => {
    const startCaptainSession = async () => {
      try {
        // Start Captain session
        const startResponse = await fetch(`${SOCKET_URL}/api/captain/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (startResponse.ok) {
          const data = await startResponse.json();
          setCaptainSessionId(data.session_id);
          currentSessionIdRef.current = data.session_id;
        }

        // Load messages from DB
        const messagesResponse = await fetch(`${SOCKET_URL}/api/captain/messages`);
        if (messagesResponse.ok) {
          const messagesData = await messagesResponse.json();
          if (messagesData.success && messagesData.messages?.length > 0) {
            // Map DB messages to Message format
            const dbMessages: Message[] = messagesData.messages.map((m: {
              id: string;
              role: string;
              content: string;
              timestamp: number;
            }) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: m.timestamp,
              streaming: false,
            }));
            setMessages(dbMessages);
            // Also save to localStorage as cache
            saveMessages(dbMessages);
          }
        }
      } catch (error) {
        // Captain session creation failed, retry on next mount
        // Fall back to localStorage if API fails
        const localMessages = loadMessages();
        if (localMessages.length > 0) {
          setMessages(localMessages);
        }
      }
    };

    startCaptainSession();
  }, []);

  // Poll Captain status for context percentage
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${SOCKET_URL}/api/captain/status`);
        if (res.ok) {
          const data = await res.json();
          setContextPct(data.contextPct ?? 0);
        }
      } catch {
        // Status fetch failed, keep current value
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // Safety timeout helpers
  const clearSafetyTimeout = useCallback(() => {
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
  }, []);

  const startSafetyTimeout = useCallback(() => {
    clearSafetyTimeout();
    safetyTimeoutRef.current = setTimeout(() => {
      setIsStreaming(false);
      setIsThinking(false);
      setToolActivity(null);
      safetyTimeoutRef.current = null;
    }, SAFETY_TIMEOUT_MS);
  }, [clearSafetyTimeout]);

  // Cleanup safety timeout on unmount
  useEffect(() => {
    return () => {
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }
    };
  }, []);

  // Join Captain's Socket.IO room when session is ready
  useEffect(() => {
    if (!socket || !captainSessionId) return;

    socket.emit('join_captain');

    // Re-register on reconnect (socket.id changes, server-side callback was cleaned up)
    const handleReconnect = () => {
      socket.emit('join_captain');
    };
    socket.io.on('reconnect', handleReconnect);

    return () => {
      socket.io.off('reconnect', handleReconnect);
    };
  }, [socket, captainSessionId]);

  // Listen for streaming messages
  useEffect(() => {
    if (!socket || !captainSessionId) return;

    const handleCaptainThinking = (_data: { thinking: string }) => {
      setIsThinking(true);
    };

    const handleCaptainToolUse = (data: { tool: string; input?: unknown }) => {
      const label = TOOL_LABELS[data.tool] ?? DEFAULT_TOOL_LABEL;
      setToolActivity(label);
      setIsThinking(true);
    };

    const handleCaptainText = (data: { text: string; message_index: number }) => {
      setIsThinking(false);
      setToolActivity(null);

      if (data.message_index === messageIndexRef.current) {
        // Update last assistant message content
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, -1),
            { ...last, content: data.text },
          ];
        });
      } else {
        // New assistant message
        messageIndexRef.current = data.message_index;
        const newMessage: Message = {
          id: `assistant_${Date.now()}_${data.message_index}`,
          role: 'assistant',
          content: data.text,
          timestamp: Date.now(),
          streaming: false,
        };
        setMessages((prev) => [...prev, newMessage]);
      }
      setIsStreaming(true);
    };

    const handleCaptainComplete = () => {
      setToolActivity(null);
      messageIndexRef.current = -1;
      clearSafetyTimeout();
      setIsThinking(false);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg.role === 'assistant') {
          updated[updated.length - 1] = {
            ...lastMsg,
            streaming: false,
          };
        }
        return updated;
      });
      setIsStreaming(false);
    };

    const handleCaptainError = (data: { message: string }) => {
      setToolActivity(null);
      messageIndexRef.current = -1;
      clearSafetyTimeout();
      setIsThinking(false);
      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${data.message}`,
        timestamp: Date.now(),
        streaming: false,
      };
      setMessages((prev) => [...prev, errorMessage]);
      setIsStreaming(false);
    };

    const handleThinkingStatus = (data: { isThinking: boolean }) => {
      setIsModelThinking(data.isThinking);
    };

    const handleCaptainInteractive = (data: InteractiveMessage) => {
      setIsModelThinking(false);
      setIsThinking(false);
      setIsStreaming(false);
      const now = Date.now();
      const normalizedMessage = data.expiresAt && data.expiresAt <= now
        ? { ...data, responseState: 'expired' as const }
        : data;
      setInteractiveMessages((prev) => [...prev, normalizedMessage]);
    };

    const handleSessionProposal = (data: {
      sessionId: string;
      prompt: string;
      workspace: string;
      workflow: string;
      timestamp: number;
    }) => {
      const proposalMessage: Message = {
        id: `proposal_${data.sessionId}_${data.timestamp}`,
        role: 'assistant',
        content: '',
        timestamp: data.timestamp,
        streaming: false,
        type: 'session_proposal',
        sessionId: data.sessionId,
        proposalPrompt: data.prompt,
        proposalWorkspace: data.workspace,
        proposalWorkflow: data.workflow,
      };
      setMessages((prev) => [...prev, proposalMessage]);
    };

    socket.on('captain_thinking', handleCaptainThinking);
    socket.on('captain_tool_use', handleCaptainToolUse);
    socket.on('captain_text', handleCaptainText);
    socket.on('captain_complete', handleCaptainComplete);
    socket.on('captain_error', handleCaptainError);
    socket.on('thinking_status', handleThinkingStatus);
    socket.on('captain_interactive', handleCaptainInteractive);
    socket.on('session_proposal', handleSessionProposal);

    return () => {
      socket.off('captain_thinking', handleCaptainThinking);
      socket.off('captain_tool_use', handleCaptainToolUse);
      socket.off('captain_text', handleCaptainText);
      socket.off('captain_complete', handleCaptainComplete);
      socket.off('captain_error', handleCaptainError);
      socket.off('thinking_status', handleThinkingStatus);
      socket.off('captain_interactive', handleCaptainInteractive);
      socket.off('session_proposal', handleSessionProposal);
    };
  }, [socket, captainSessionId, clearSafetyTimeout]);

  // Handle timeouts for interactive messages
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    const now = Date.now();

    interactiveMessages.forEach((msg) => {
      if (msg.responseState === 'pending' && msg.expiresAt && msg.expiresAt > now) {
        const delay = msg.expiresAt - now;
        const timer = setTimeout(() => {
          setInteractiveMessages((prev) =>
            prev.map((m) =>
              m.id === msg.id && m.responseState === 'pending'
                ? { ...m, responseState: 'expired' as const }
                : m
            )
          );
        }, delay);
        timers.push(timer);
      }
    });

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [interactiveMessages]);

  const respondToInteractive = useCallback(
    (messageId: string, actionId: string) => {
      if (!socket) return;

      socket.emit('captain_interactive_response', { messageId, actionId });

      setInteractiveMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, responseState: 'responded' as const, selectedActionId: actionId }
            : msg
        )
      );
    },
    [socket]
  );

  const sendMessage = useCallback(
    async (content: string, _workspace?: string, model?: string, imageIds?: string[], images?: ImageAttachment[]) => {
      if (!socket || !captainSessionId || (!content.trim() && !imageIds?.length)) return;

      // Handle /clear command
      if (content.trim() === '/clear') {
        // Archive current conversation if it has messages
        if (messages.length > 0) {
          const conversation: CaptainConversation = {
            id: `conv_${Date.now()}`,
            messages: [...messages],
            startedAt: messages[0].timestamp,
            endedAt: messages[messages.length - 1].timestamp,
          };
          const updated = [conversation, ...archivedConversations].slice(0, MAX_ARCHIVED);
          setArchivedConversations(updated);
          saveArchive(updated);
        }

        // Clear local state
        setMessages([]);
        saveMessages([]);
        setInteractiveMessages([]);
        setContextPct(0);

        // Notify backend to start new conversation
        try {
          const clearRes = await fetch(`${SOCKET_URL}/api/captain/messages/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (clearRes.ok) {
            const clearData = await clearRes.json();
            if (clearData.session_id) {
              setCaptainSessionId(clearData.session_id);
              currentSessionIdRef.current = clearData.session_id;
            }
          }
        } catch (error) {
          // Clear request failed, but local state is already cleared
        }

        return;
      }

      const userMessage: Message = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: content || '[Image]',
        timestamp: Date.now(),
        images,
      };

      setMessages((prev) => [...prev, userMessage]);

      socket.emit('captain_message', { content: content || '[Image]', image_ids: imageIds?.length ? imageIds : undefined });

      setIsStreaming(true);
      setIsThinking(true);
      messageIndexRef.current = -1;
      setToolActivity(null);
      startSafetyTimeout();
    },
    [socket, captainSessionId, messages, archivedConversations, startSafetyTimeout]
  );

  const clearHistory = useCallback(() => {
    setArchivedConversations([]);
    saveArchive([]);
  }, []);

  return {
    captainSessionId,
    messages,
    isStreaming,
    isThinking,
    isModelThinking,
    toolActivity,
    sendMessage,
    archivedConversations,
    clearHistory,
    interactiveMessages,
    respondToInteractive,
    contextPct,
  };
}

export type CaptainSocketState = ReturnType<typeof useCaptainSocket>;
