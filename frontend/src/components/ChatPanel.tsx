import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, ToolEvent, ToolDisplayMode } from '../types';
import { MessageBubble } from './MessageBubble';
import { ProjectSelector } from './ProjectSelector';
import { ModelSelector } from './ModelSelector';
import { ToolDisplayToggle } from './ToolDisplayToggle';
import './ChatPanel.css';

interface ChatPanelProps {
  messages: Message[];
  connected: boolean;
  streaming: boolean;
  currentTool?: ToolEvent | null;
  selectedProject: string | null;
  selectedModel: string;
  toolDisplayMode: ToolDisplayMode;
  onSendMessage: (content: string, workspace?: string, model?: string) => void;
  onSelectProject: (path: string) => void;
  onSelectModel: (model: string) => void;
  onToolDisplayModeChange: (mode: ToolDisplayMode) => void;
  onCancel: () => void;
  onThemePanelToggle?: (isOpen: boolean) => void;
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

function formatToolLabel(event: ToolEvent): string {
  const params = event.parameters || {};
  switch (event.tool_name) {
    case 'Read':
      return `Reading ${basename(String(params.file_path || ''))}`;
    case 'Write':
      return `Writing ${basename(String(params.file_path || ''))}`;
    case 'Edit':
      return `Editing ${basename(String(params.file_path || ''))}`;
    case 'Bash':
      return `Running ${String(params.command || '').slice(0, 40)}`;
    case 'Glob':
      return `Searching ${String(params.pattern || '')}`;
    case 'Grep':
      return `Searching ${String(params.pattern || '')}`;
    case 'Agent':
    case 'Task':
      return `Using ${event.agent_type || 'agent'}`;
    default:
      return `Using ${event.tool_name}`;
  }
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  connected,
  streaming,
  currentTool,
  selectedProject,
  selectedModel,
  toolDisplayMode,
  onSendMessage,
  onSelectProject,
  onSelectModel,
  onToolDisplayModeChange,
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
          <ToolDisplayToggle
            mode={toolDisplayMode}
            onToggle={onToolDisplayModeChange}
          />
          <button
            className="theme-toggle-btn"
            onClick={() => onThemePanelToggle?.(true)}
            aria-label="Theme settings"
            title="Theme settings"
          >
            ⚙️
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
        {messages
          .filter((m) => toolDisplayMode === 'verbose' || !m.tool)
          .map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        {streaming && !messages.some((m) => m.streaming) && (
          <div className="thinking-indicator">
            {currentTool ? (
              <div className="tool-status">{formatToolLabel(currentTool)}</div>
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

      {toolDisplayMode === 'minimal' && streaming && currentTool && (
        <div className="minimal-tool-indicator">
          <span className="pulsing-dot" />
          {formatToolLabel(currentTool)}
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
