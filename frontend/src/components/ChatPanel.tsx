import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, ToolEvent } from '../types';
import { MessageBubble } from './MessageBubble';
import { ProjectSelector } from './ProjectSelector';
import { ModelSelector } from './ModelSelector';
import { ToolLog } from './ToolLog';
import { formatToolLabelVerbose } from '../utils/formatToolLabel';
import './ChatPanel.css';

const THINKING_MESSAGES = [
  'Thinking...',
  'Reasoning...',
  'Exploring the codebase...',
  'Reading the code...',
  'Analyzing patterns...',
  'Considering options...',
  'Connecting the dots...',
];

interface ChatPanelProps {
  messages: Message[];
  connected: boolean;
  streaming: boolean;
  sessionId: string;
  currentTool?: ToolEvent | null;
  toolLog: ToolEvent[];
  selectedProject: string | null;
  selectedModel: string;
  onSendMessage: (content: string, workspace?: string, model?: string) => void;
  onSelectProject: (path: string) => void;
  onSelectModel: (model: string) => void;
  onCancel: () => void;
  onToggleSessions?: () => void;
  onToggleActivity?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  connected,
  streaming,
  sessionId,
  currentTool,
  toolLog,
  selectedProject,
  selectedModel,
  onSendMessage,
  onSelectProject,
  onSelectModel,
  onCancel,
  onToggleSessions,
  onToggleActivity,
}) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [thinkingMsgIndex, setThinkingMsgIndex] = useState(0);

  const examplePrompts = [
    'Explain how the auth system works',
    'Find and fix any TypeScript errors',
    'Refactor this file for readability',
    'Write tests for the API endpoints',
  ];

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Autofocus textarea on mount, new chat, or session switch
  useEffect(() => {
    if (textareaRef.current && !streaming) {
      textareaRef.current.focus();
    }
  }, [sessionId, streaming]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

  // Rotate thinking messages
  useEffect(() => {
    if (!streaming) {
      setThinkingMsgIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setThinkingMsgIndex((prev) => (prev + 1) % THINKING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [streaming]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || !connected) return;
    onSendMessage(trimmed, selectedProject || undefined, selectedModel);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (streaming) return;
      handleSubmit();
    }
  };

  return (
    <>
      <div className="chat-panel">
        <div className="chat-panel-header">
          <div className="header-left">
            {onToggleSessions && (
              <button
                className="mobile-drawer-btn"
                onClick={onToggleSessions}
                aria-label="Toggle sessions"
                title="Sessions"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <h1 className="chat-title">CC+</h1>
            <span className={`connection-dot ${connected ? 'online' : 'offline'}`} role="status" aria-label={connected ? 'Connected' : 'Disconnected'} />
          </div>
          <div className="header-right">
            <ProjectSelector
              selectedProject={selectedProject}
              onSelectProject={onSelectProject}
            />
            <ModelSelector
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
            />
            {onToggleActivity && (
              <button
                className="mobile-drawer-btn"
                onClick={onToggleActivity}
                aria-label="Toggle activity"
                title="Activity"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                  <line x1="9" y1="1" x2="9" y2="4" />
                  <line x1="15" y1="1" x2="15" y2="4" />
                  <line x1="9" y1="20" x2="9" y2="23" />
                  <line x1="15" y1="20" x2="15" y2="23" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="messages-container" ref={messagesContainerRef} role="log" aria-label="Chat messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="ghost-activity">
                <div className="ghost-node ghost-agent">
                  <div className="ghost-bar ghost-bar-accent" />
                  <div className="ghost-content">
                    <div className="ghost-label">Agent</div>
                    <div className="ghost-line ghost-line-long" />
                  </div>
                  <div className="ghost-children">
                    <div className="ghost-node ghost-tool">
                      <div className="ghost-bar ghost-bar-success" />
                      <div className="ghost-content">
                        <div className="ghost-label">Read</div>
                        <div className="ghost-line ghost-line-medium" />
                      </div>
                    </div>
                    <div className="ghost-node ghost-tool">
                      <div className="ghost-bar ghost-bar-success" />
                      <div className="ghost-content">
                        <div className="ghost-label">Edit</div>
                        <div className="ghost-line ghost-line-short" />
                      </div>
                    </div>
                    <div className="ghost-node ghost-tool">
                      <div className="ghost-bar ghost-bar-running" />
                      <div className="ghost-content">
                        <div className="ghost-label">Bash</div>
                        <div className="ghost-line ghost-line-medium ghost-line-pulse" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="empty-subtitle">Watch every tool call, agent spawn, and decision — live</p>
              <div className="empty-prompts">
                {examplePrompts.map((prompt) => (
                  <button
                    key={prompt}
                    className="empty-prompt-btn"
                    onClick={() => {
                      setInput(prompt);
                      textareaRef.current?.focus();
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {streaming && toolLog.length > 0 && (
            <ToolLog events={toolLog} />
          )}
          {streaming && !messages.some((m) => m.streaming) && (
            <div className="thinking-indicator">
              {currentTool ? (
                <div className="tool-status">{formatToolLabelVerbose(currentTool)}</div>
              ) : (
                <div className="thinking-content">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="thinking-text" role="status">{THINKING_MESSAGES[thinkingMsgIndex]}</span>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {streaming && currentTool && (
          <div className="minimal-tool-indicator">
            <span className="pulsing-dot" />
            {formatToolLabelVerbose(currentTool)}
          </div>
        )}

        <div className="input-container">
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              className="message-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={connected ? 'Send a message...' : 'Reconnecting — hang tight...'}
              disabled={!connected}
              rows={1}
            />
            {streaming ? (
              <button className="cancel-btn" onClick={onCancel} aria-label="Cancel">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSubmit}
                disabled={!input.trim() || !connected}
                aria-label="Send"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            )}
          </div>
          {!streaming && input.trim() && (
            <div className="input-hint">
              <kbd className="kbd">Enter</kbd> to send, <kbd className="kbd">Shift+Enter</kbd> for new line
            </div>
          )}
        </div>
      </div>
    </>
  );
};
