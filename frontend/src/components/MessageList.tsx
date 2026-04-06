import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Message, ToolEvent, TodoItem, SessionStatus } from '../types';
import { MessageBubble } from './MessageBubble';
import { NewSessionDashboard } from './NewSessionDashboard';
import { TextSelectionPopup } from './TextSelectionPopup';
import { ThinkingIndicator } from './ThinkingIndicator';
import { QuestionPrompt } from './QuestionPrompt';
import { TodoProgress } from './TodoProgress';
import { UsageStats, ActivityNode, SignalState } from '../types';
import './MessageList.css';

// Threshold (px) below which we consider the user to be "at the bottom"
const BOTTOM_THRESHOLD = 200;

interface MessageListProps {
  messages: Message[];
  sessionStatus?: SessionStatus;
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
  isModelThinking?: boolean;
  todos?: TodoItem[];
  onClearTodos?: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  sessionStatus = 'idle',
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
  isModelThinking,
  todos = [],
  onClearTodos,
}) => {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const thinkingIndicatorRef = useRef<HTMLDivElement>(null);
  const [lastMessageCount, setLastMessageCount] = useState(0);
  // True when user has scrolled up away from the bottom
  const userScrolledUpRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  // Imperatively scroll to bottom — only used for session switches and the scroll-to-bottom button.
  // During normal streaming CSS scroll anchoring handles keeping the view pinned without JS.
  const scrollToBottom = useCallback((immediate = false) => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (immediate) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // Detect manual user scrolling and show/hide the scroll-to-bottom button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const atBottom = isNearBottom();
      userScrolledUpRef.current = !atBottom;
      setShowScrollBtn(!atBottom);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isNearBottom]);

  // Handle session switches: jump to bottom instantly and reset user-scroll state.
  // During streaming, CSS scroll anchoring (via .scroll-anchor) handles keeping the view at the bottom
  // without JS — no scrollTop manipulation needed per streaming token.
  useEffect(() => {
    const isSessionChange = Math.abs(messages.length - lastMessageCount) > 1;

    if (isSessionChange || messages.length === 0) {
      // Session switch: instant jump, always scroll, reset user scroll state
      userScrolledUpRef.current = false;
      setShowScrollBtn(false);
      requestAnimationFrame(() => scrollToBottom(true));
    } else if (messages.length !== lastMessageCount && !userScrolledUpRef.current) {
      // New non-streaming message added and user is at bottom: smooth scroll to reveal it.
      // CSS anchoring covers in-message streaming tokens, so this only fires for new message bubbles.
      scrollToBottom(false);
    }

    setLastMessageCount(messages.length);
  }, [messages.length, lastMessageCount, scrollToBottom]);

  // Scope ResizeObserver to ThinkingIndicator only (not the whole container).
  // CSS scroll anchoring already keeps the bottom pinned during streaming, so we only
  // need to nudge scroll when the ThinkingIndicator grows (new agent nodes, status changes).
  useEffect(() => {
    const indicator = thinkingIndicatorRef.current;
    if (!indicator) return;

    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current && streaming) {
        scrollToBottom(true);
      }
    });

    observer.observe(indicator);
    return () => observer.disconnect();
  }, [streaming, scrollToBottom]);

  return (
    <div
      className="messages-container"
      ref={messagesContainerRef}
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
    >
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
      {todos && todos.length > 0 && onClearTodos && (
        <TodoProgress todos={todos} onDismiss={onClearTodos} />
      )}
      {/* C2: Submitted spinner — appears immediately after user sends, before first token */}
      {sessionStatus === 'submitted' && !isRestoringSession && (
        <div className="submitted-indicator" aria-label="Processing message" role="status">
          <span className="submitted-dot" />
          <span className="submitted-dot" />
          <span className="submitted-dot" />
        </div>
      )}
      {sessionStatus === 'streaming' && !isRestoringSession && (
        <div ref={thinkingIndicatorRef}>
          <ThinkingIndicator activityTree={activityTree} signals={signals} isModelThinking={isModelThinking} />
        </div>
      )}
      {/* Legacy: keep showing ThinkingIndicator for bare streaming=true (backward compat with callers that don't pass sessionStatus) */}
      {streaming && sessionStatus === 'idle' && !isRestoringSession && (
        <div ref={thinkingIndicatorRef}>
          <ThinkingIndicator activityTree={activityTree} signals={signals} isModelThinking={isModelThinking} />
        </div>
      )}
      {/* CSS scroll anchor: overflow-anchor:auto on this element keeps the view pinned to the
          bottom during streaming without any JS scrollTop manipulation. The browser handles this
          in the compositor thread, avoiding layout thrash on every streaming token. */}
      <div className="scroll-anchor" aria-hidden="true" />
      <button
        className={`scroll-to-bottom-btn${showScrollBtn ? ' visible' : ''}`}
        onClick={() => {
          userScrolledUpRef.current = false;
          setShowScrollBtn(false);
          scrollToBottom(false);
        }}
        aria-label="Scroll to latest message"
        tabIndex={showScrollBtn ? 0 : -1}
      >
        ↓ Latest
      </button>
    </div>
  );
};
