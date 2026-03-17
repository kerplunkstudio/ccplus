import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Message, ToolEvent } from '../types';
import { MessageBubble } from './MessageBubble';
import { NewSessionDashboard } from './NewSessionDashboard';
import { TextSelectionPopup } from './TextSelectionPopup';
import { ThinkingIndicator } from './ThinkingIndicator';
import { QuestionPrompt } from './QuestionPrompt';
import { UsageStats, ActivityNode, SignalState } from '../types';
import './MessageList.css';

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
  isRestoringSession: boolean;
  projectPath?: string | null;
  usageStats: UsageStats;
  pastSessions: Array<{session_id: string; last_user_message: string | null; last_activity: string}>;
  onLoadSession?: (sessionId: string) => void;
  onSendToNewSession?: (text: string) => void;
  onOpenBrowserTab?: (url: string, label: string) => void;
  pendingQuestion?: {
    questions: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description: string }>;
      multiSelect: boolean;
    }>;
    toolUseId: string;
  } | null;
  onRespondToQuestion?: (response: Record<string, string>) => void;
  currentTool?: ToolEvent | null;
  toolLog: ToolEvent[];
  activityTree?: ActivityNode[];
  signals?: SignalState;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streaming,
  isRestoringSession,
  projectPath,
  usageStats,
  pastSessions,
  onLoadSession,
  onSendToNewSession,
  onOpenBrowserTab,
  pendingQuestion,
  onRespondToQuestion,
  currentTool,
  toolLog,
  activityTree = [],
  signals,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [lastMessageCount, setLastMessageCount] = useState(0);
  const userScrolledUpRef = useRef(false);
  const programmaticScrollRef = useRef(false);

  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 200;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback((immediate = false) => {
    const container = messagesContainerRef.current;
    if (!container) return;

    programmaticScrollRef.current = true;
    if (immediate) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  // Detect manual user scrolling
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Ignore programmatic scrolls
      if (programmaticScrollRef.current) return;

      // Check if user scrolled away from bottom
      if (!isNearBottom()) {
        userScrolledUpRef.current = true;
      } else {
        // User scrolled back to bottom
        userScrolledUpRef.current = false;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isNearBottom]);

  // Auto-scroll on new messages, streaming content, or tool activity updates
  useEffect(() => {
    const isSessionChange = Math.abs(messages.length - lastMessageCount) > 1;
    const hasStreamingMessage = messages.some((m) => m.streaming);

    if (isSessionChange || messages.length === 0) {
      // Session switch: instant jump, always scroll
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    } else if (hasStreamingMessage || streaming || currentTool) {
      // During streaming or tool activity: instant scroll unless user scrolled up
      if (!userScrolledUpRef.current) {
        scrollToBottom(true);
      }
    } else if (messages.length !== lastMessageCount) {
      // New message added (not streaming): smooth scroll unless user scrolled up
      if (!userScrolledUpRef.current) {
        scrollToBottom(false);
      }
    }
    setLastMessageCount(messages.length);
  }, [messages, scrollToBottom, lastMessageCount, streaming, pendingQuestion, currentTool, toolLog]);

  return (
    <div className="messages-container" ref={messagesContainerRef} role="log" aria-label="Chat messages" aria-live="polite">
      {onSendToNewSession && (
        <TextSelectionPopup
          onSendToNewSession={onSendToNewSession}
          containerRef={messagesContainerRef}
        />
      )}
      {isRestoringSession && (
        <div className="session-restore-loader">
          <div className="restore-content">
            <div className="restore-line restore-line-1" />
            <div className="restore-line restore-line-2" />
            <div className="restore-line restore-line-3" />
          </div>
        </div>
      )}
      {messages.length === 0 && !isRestoringSession && (
        <NewSessionDashboard
          projectPath={projectPath || null}
          usageStats={usageStats}
          pastSessions={pastSessions}
          onLoadSession={onLoadSession || (() => {})}
        />
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onLinkClick={onOpenBrowserTab} />
      ))}
      {pendingQuestion && onRespondToQuestion && (
        <QuestionPrompt
          pendingQuestion={pendingQuestion}
          onRespondToQuestion={onRespondToQuestion}
        />
      )}
      {streaming && !isRestoringSession && (
        <ThinkingIndicator activityTree={activityTree} signals={signals} />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};
