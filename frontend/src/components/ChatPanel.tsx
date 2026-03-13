import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, ToolEvent } from '../types';
import { MessageBubble } from './MessageBubble';
import { ProjectSelector } from './ProjectSelector';
import { ModelSelector } from './ModelSelector';
import { ToolLog } from './ToolLog';
import { formatToolLabelVerbose } from '../utils/formatToolLabel';
import './ChatPanel.css';

interface ChatPanelProps {
  messages: Message[];
  connected: boolean;
  streaming: boolean;
  currentTool?: ToolEvent | null;
  toolLog: ToolEvent[];
  selectedProject: string | null;
  selectedModel: string;
  onSendMessage: (content: string, workspace?: string, model?: string) => void;
  onSelectProject: (path: string) => void;
  onSelectModel: (model: string) => void;
  onCancel: () => void;
  onThemePanelToggle?: (isOpen: boolean) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  connected,
  streaming,
  currentTool,
  toolLog,
  selectedProject,
  selectedModel,
  onSendMessage,
  onSelectProject,
  onSelectModel,
  onCancel,
  onThemePanelToggle,
}) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

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
    <div className="chat-panel">
      <div className="chat-panel-header">
        <div className="header-left">
          <h1 className="chat-title">CC+</h1>
          <span className={`connection-dot ${connected ? 'online' : 'offline'}`} />
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
          <button
            className="theme-toggle-btn"
            onClick={() => onThemePanelToggle?.(true)}
            aria-label="Theme settings"
            title="Theme settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.902 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.116l.094-.318z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="messages-container" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">{'>'}_</div>
            <p className="empty-title">Start a conversation</p>
            <p className="empty-subtitle">Ask anything or request a coding task</p>
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
                <span className="thinking-text">Thinking...</span>
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
            placeholder={connected ? 'Send a message...' : 'Connecting...'}
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
      </div>
    </div>
  );
};
