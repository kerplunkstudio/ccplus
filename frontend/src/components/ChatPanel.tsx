import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, ToolEvent } from '../types';
import { MessageBubble } from './MessageBubble';
import { ModelSelector } from './ModelSelector';
import { PluginButton } from './PluginButton';
import { PluginModal } from './PluginModal';
import { ToolLog } from './ToolLog';
import { SlashCommandAutocomplete } from './SlashCommandAutocomplete';
import { ExpertEmptyState } from './ExpertEmptyState';
import { formatToolLabelVerbose } from '../utils/formatToolLabel';
import { useSkills } from '../hooks/useSkills';
import {
  parseSlashCommand,
  shouldShowAutocomplete,
  filterSkills,
  getAllSuggestions,
} from '../utils/slashCommands';
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

const formatTimeAgo = (timestamp: string): string => {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

interface ChatPanelProps {
  messages: Message[];
  connected: boolean;
  streaming: boolean;
  currentTool?: ToolEvent | null;
  toolLog: ToolEvent[];
  selectedModel: string;
  onSendMessage: (content: string, workspace?: string, model?: string) => void;
  onSelectModel: (model: string) => void;
  onCancel: () => void;
  onToggleSessions?: () => void;
  onToggleActivity?: () => void;
  projectPath?: string | null;
  onLoadSession?: (sessionId: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  connected,
  streaming,
  currentTool,
  toolLog,
  selectedModel,
  onSendMessage,
  onSelectModel,
  onCancel,
  onToggleSessions,
  onToggleActivity,
  projectPath,
  onLoadSession,
}) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [thinkingMsgIndex, setThinkingMsgIndex] = useState(0);
  const [pluginModalOpen, setPluginModalOpen] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const { skills } = useSkills();
  const [pastSessions, setPastSessions] = useState<Array<{session_id: string; last_user_message: string | null; last_activity: string}>>([]);
  const [showPastSessions, setShowPastSessions] = useState(false);
  const [isExpertUser, setIsExpertUser] = useState(false);

  // Detect if user is experienced based on usage patterns
  const detectExpertUser = useCallback(() => {
    const sessionCount = parseInt(localStorage.getItem('ccplus_session_count') || '0');
    const totalMessages = parseInt(localStorage.getItem('ccplus_total_messages') || '0');
    const lastSessionDate = localStorage.getItem('ccplus_last_session');
    const isReturningUser = lastSessionDate &&
      (Date.now() - new Date(lastSessionDate).getTime()) > 86400000; // 24+ hours ago

    // User is expert if they have:
    // - 3+ sessions, OR
    // - 10+ total messages, OR
    // - Returning after 24+ hours, OR
    // - Has saved favorite commands
    const favoriteCommands = JSON.parse(localStorage.getItem('ccplus_favorite_commands') || '[]');

    return sessionCount >= 3 ||
           totalMessages >= 10 ||
           isReturningUser ||
           favoriteCommands.length > 0;
  }, []);

  // Track user activity for experience detection
  const trackUserActivity = useCallback(() => {
    const currentSession = parseInt(localStorage.getItem('ccplus_session_count') || '0') + 1;
    const currentMessages = parseInt(localStorage.getItem('ccplus_total_messages') || '0');

    localStorage.setItem('ccplus_session_count', currentSession.toString());
    localStorage.setItem('ccplus_last_session', new Date().toISOString());

    // Update workspace tracking if we have a project
    if (projectPath) {
      const workspaces = JSON.parse(localStorage.getItem('ccplus_recent_workspaces') || '[]');
      const updated = [projectPath, ...workspaces.filter((w: string) => w !== projectPath)].slice(0, 5);
      localStorage.setItem('ccplus_recent_workspaces', JSON.stringify(updated));
    }
  }, [projectPath]);

  const examplePrompts = [
    'Watch agents work in parallel on a feature',
    'Fix a bug and trace every tool call live',
    'Refactor something complex — show me the full tool trace',
    'Run tests and observe what Claude reads and changes',
  ];

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Initialize expert user detection on mount
  useEffect(() => {
    setIsExpertUser(detectExpertUser());
    trackUserActivity();
  }, [detectExpertUser, trackUserActivity]);

  // Track message count for experience detection
  useEffect(() => {
    if (messages.length > 0) {
      const currentMessages = parseInt(localStorage.getItem('ccplus_total_messages') || '0');
      localStorage.setItem('ccplus_total_messages', (currentMessages + 1).toString());
    }
  }, [messages.length]);

  // Autofocus textarea on mount, new chat, or session switch
  useEffect(() => {
    if (textareaRef.current && !streaming) {
      textareaRef.current.focus();
    }
  }, [messages.length, streaming]);

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

  // Fetch past sessions when empty state is shown
  useEffect(() => {
    if (messages.length > 0 || !projectPath) {
      setPastSessions([]);
      setShowPastSessions(false);
      return;
    }
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
    fetch(`${SOCKET_URL}/api/sessions?project=${encodeURIComponent(projectPath)}`)
      .then(res => res.ok ? res.json() : { sessions: [] })
      .then(data => setPastSessions(data.sessions || []))
      .catch(() => setPastSessions([]));
  }, [messages.length, projectPath]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || !connected) return;

    // Track favorite commands for expert detection
    if (trimmed.startsWith('/') || trimmed.includes('agent') || trimmed.includes('test') || trimmed.includes('review')) {
      const favorites = JSON.parse(localStorage.getItem('ccplus_favorite_commands') || '[]');
      const updated = [trimmed, ...favorites.filter((cmd: string) => cmd !== trimmed)].slice(0, 10);
      localStorage.setItem('ccplus_favorite_commands', JSON.stringify(updated));
    }

    onSendMessage(trimmed);
    setInput('');
    setShowAutocomplete(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // Get filtered autocomplete suggestions
  const getAutocompleteSuggestions = () => {
    const command = parseSlashCommand(input);
    if (!command) return [];

    const allSuggestions = getAllSuggestions(skills);
    return filterSkills(allSuggestions, command.command);
  };

  const autocompleteSuggestions = getAutocompleteSuggestions();

  // Handle input changes for autocomplete
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInput(newValue);

    const cursorPosition = e.target.selectionStart || 0;
    const shouldShow = shouldShowAutocomplete(newValue, cursorPosition);

    if (shouldShow && newValue.startsWith('/')) {
      setShowAutocomplete(true);
      setAutocompleteIndex(0);
    } else {
      setShowAutocomplete(false);
    }
  };

  // Handle autocomplete selection
  const handleAutocompleteSelect = (suggestion: { name: string }) => {
    setInput(`/${suggestion.name} `);
    setShowAutocomplete(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle autocomplete navigation
    if (showAutocomplete && autocompleteSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteIndex((prev) =>
          prev < autocompleteSuggestions.length - 1 ? prev + 1 : prev
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const selected = autocompleteSuggestions[autocompleteIndex];
        if (selected) {
          handleAutocompleteSelect(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      }
    }

    // Normal message sending
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (streaming) return;
      handleSubmit();
    }
  };

  return (
    <>
      <PluginModal isOpen={pluginModalOpen} onClose={() => setPluginModalOpen(false)} />
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <span className={`connection-dot ${connected ? 'online' : 'offline'}`} role="status" aria-label={connected ? 'Connected' : 'Disconnected'} />
          </div>
          <div className="header-right">
            <ModelSelector
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
            />
            <PluginButton onClick={() => setPluginModalOpen(true)} />
            {onToggleActivity && (
              <button
                className="mobile-drawer-btn"
                onClick={onToggleActivity}
                aria-label="Toggle activity"
                title="Activity"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
            <>
              {isExpertUser ? (
                <ExpertEmptyState
                  onSendMessage={(command) => {
                    onSendMessage(command);
                    // Track as favorite command
                    const favorites = JSON.parse(localStorage.getItem('ccplus_favorite_commands') || '[]');
                    const updated = [command, ...favorites.filter((cmd: string) => cmd !== command)].slice(0, 10);
                    localStorage.setItem('ccplus_favorite_commands', JSON.stringify(updated));
                  }}
                  projectPath={projectPath}
                  textareaRef={textareaRef}
                />
              ) : (
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
                  {pastSessions.length > 0 && (
                    <div className="past-sessions-hint">
                      <button
                        className="past-sessions-toggle"
                        onClick={() => setShowPastSessions(!showPastSessions)}
                      >
                        {pastSessions.length} past session{pastSessions.length !== 1 ? 's' : ''}
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: showPastSessions ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
                          <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      </button>
                      {showPastSessions && (
                        <div className="past-sessions-list">
                          {pastSessions.slice(0, 5).map((session) => (
                            <button
                              key={session.session_id}
                              className="past-session-item"
                              onClick={() => onLoadSession?.(session.session_id)}
                            >
                              <span className="past-session-label">
                                {session.last_user_message || 'Empty session'}
                              </span>
                              <span className="past-session-time">
                                {formatTimeAgo(session.last_activity)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
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
          {showAutocomplete && autocompleteSuggestions.length > 0 && (
            <SlashCommandAutocomplete
              suggestions={autocompleteSuggestions}
              selectedIndex={autocompleteIndex}
              onSelect={handleAutocompleteSelect}
              onClose={() => setShowAutocomplete(false)}
              inputRef={textareaRef}
            />
          )}
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              className="message-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={connected ? 'Send a message or type / for commands...' : 'Reconnecting — hang tight...'}
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
