import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { Message, ImageAttachment } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
const STORAGE_KEY = 'ccplus_captain_messages';
const ARCHIVE_KEY = 'ccplus_captain_archive';
const MAX_ARCHIVED = 20;

interface CaptainConversation {
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
  const currentSessionIdRef = useRef<string>('');

  // Initialize Captain session on mount
  useEffect(() => {
    const startCaptainSession = async () => {
      try {
        const response = await fetch(`${SOCKET_URL}/api/captain/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          setCaptainSessionId(data.session_id);
          currentSessionIdRef.current = data.session_id;
        }
      } catch (error) {
        // Captain session creation failed, retry on next mount
      }
    };

    startCaptainSession();
  }, []);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // Join Captain's Socket.IO room when session is ready
  useEffect(() => {
    if (!socket || !captainSessionId) return;

    socket.emit('join_captain');

    return () => {
      socket.emit('leave_captain');
    };
  }, [socket, captainSessionId]);

  // Listen for streaming messages
  useEffect(() => {
    if (!socket || !captainSessionId) return;

    const handleCaptainThinking = (_data: { thinking: string }) => {
      setIsThinking(true);
    };

    const handleCaptainText = (data: { text: string; message_index: number }) => {
      setIsThinking(false);
      // Backend sends full text per assistant message (not streaming deltas)
      const newMessage: Message = {
        id: `assistant_${Date.now()}_${data.message_index}`,
        role: 'assistant',
        content: data.text,
        timestamp: Date.now(),
        streaming: false,
      };
      setMessages((prev) => [...prev, newMessage]);
      setIsStreaming(true);
    };

    const handleCaptainComplete = () => {
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

    socket.on('captain_thinking', handleCaptainThinking);
    socket.on('captain_text', handleCaptainText);
    socket.on('captain_complete', handleCaptainComplete);
    socket.on('captain_error', handleCaptainError);

    return () => {
      socket.off('captain_thinking', handleCaptainThinking);
      socket.off('captain_text', handleCaptainText);
      socket.off('captain_complete', handleCaptainComplete);
      socket.off('captain_error', handleCaptainError);
    };
  }, [socket, captainSessionId]);

  const sendMessage = useCallback(
    (content: string, model?: string, imageIds?: string[], images?: ImageAttachment[]) => {
      if (!socket || !captainSessionId || !content.trim()) return;

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
        setMessages([]);
        saveMessages([]);
        return;
      }

      const userMessage: Message = {
        id: `user_${Date.now()}`,
        role: 'user',
        content,
        timestamp: Date.now(),
        images,
      };

      setMessages((prev) => [...prev, userMessage]);

      socket.emit('captain_message', { content });

      setIsStreaming(true);
      setIsThinking(true);
    },
    [socket, captainSessionId, messages, archivedConversations]
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
    sendMessage,
    archivedConversations,
    clearHistory,
  };
}
