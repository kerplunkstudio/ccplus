import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, ToolEvent, UsageStats } from '../types';
import { MessageBubble } from './MessageBubble';
import { ModelSelector } from './ModelSelector';
import { PluginButton } from './PluginButton';
import { PluginModal } from './PluginModal';
import { ToolLog } from './ToolLog';
import { SlashCommandAutocomplete } from './SlashCommandAutocomplete';
import { NewSessionDashboard } from './NewSessionDashboard';
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
  usageStats: UsageStats;
  onSendMessage: (content: string, workspace?: string, model?: string, imageIds?: string[]) => void;
  onSelectModel: (model: string) => void;
  onCancel: () => void;
  onToggleSessions?: () => void;
  onToggleActivity?: () => void;
  projectPath?: string | null;
  onLoadSession?: (sessionId: string) => void;
  sessionId?: string;
  pendingQuestion?: {
    questions: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
    }>;
    toolUseId: string;
} | null;
  onRespondToQuestion?: (response: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  connected,
  streaming,
  currentTool,
  toolLog,
  selectedModel,
  usageStats,
  onSendMessage,
  onSelectModel,
  onCancel,
  onToggleSessions,
  onToggleActivity,
  projectPath,
  onLoadSession,
  sessionId,
  pendingQuestion,
  onRespondToQuestion,
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
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({});
  const [uploadedImages, setUploadedImages] = useState<Array<{ id: string; filename: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastMessageCount, setLastMessageCount] = useState(0);

  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 150;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback((immediate = false) => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (immediate) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  // Auto-scroll on new messages or streaming content updates
  useEffect(() => {
    const isSessionChange = Math.abs(messages.length - lastMessageCount) > 1;
    const hasStreamingMessage = messages.some((m) => m.streaming);

    if (isSessionChange || messages.length === 0) {
      // Session switch: instant jump
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    } else if (hasStreamingMessage) {
      // During streaming: instant scroll if near bottom
      if (isNearBottom()) {
        scrollToBottom(true);
      }
    } else if (messages.length !== lastMessageCount) {
      // New message added (not streaming): smooth scroll if near bottom
      if (isNearBottom()) {
        scrollToBottom(false);
      }
    }
    setLastMessageCount(messages.length);
  }, [messages, scrollToBottom, lastMessageCount, isNearBottom]);

  // Always snap to bottom on session switch
  useEffect(() => {
    requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [sessionId]);

  useEffect(() => {
    if (pendingQuestion) {
      setQuestionSelections({});
    }
  }, [pendingQuestion]);

  // Keep textarea always focused and ready for input
  useEffect(() => {
    const focusTextarea = () => {
      if (textareaRef.current && !pendingQuestion) {
        textareaRef.current.focus();
      }
    };

    // Focus on mount, session switch, streaming end
    const focusTimeout = setTimeout(focusTextarea, 50);

    // Re-focus when window regains focus
    window.addEventListener('focus', focusTextarea);

    // Re-focus when clicking anywhere in the document
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't steal focus from buttons or interactive elements outside the input
      if (target.closest('button') || target.closest('a') || target.closest('[contenteditable]')) {
        return;
      }
      focusTextarea();
    };
    document.addEventListener('click', handleClick);

    return () => {
      clearTimeout(focusTimeout);
      window.removeEventListener('focus', focusTextarea);
      document.removeEventListener('click', handleClick);
    };
  }, [messages.length, streaming, connected, sessionId, pendingQuestion]);

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
    if ((!trimmed && uploadedImages.length === 0) || !connected) return;

    const imageIds = uploadedImages.map(img => img.id);
    onSendMessage(trimmed || '[Image]', undefined, undefined, imageIds.length > 0 ? imageIds : undefined);
    setInput('');
    setUploadedImages([]);
    setShowAutocomplete(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

    for (const file of Array.from(files)) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert(`${file.name} is not an image file`);
        continue;
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} is too large (max 10MB)`);
        continue;
      }

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('session_id', sessionId || '');

        const response = await fetch(`${SOCKET_URL}/api/images/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Upload failed');
        }

        const imageData = await response.json();
        setUploadedImages(prev => [...prev, imageData]);
      } catch (error) {
        alert(`Failed to upload ${file.name}`);
      }
    }

    setUploading(false);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (imageId: string) => {
    setUploadedImages(prev => prev.filter(img => img.id !== imageId));
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
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
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
            <span className={`connection-status ${connected ? 'online' : 'offline'}`} role="status" aria-label={connected ? 'Connected' : 'Disconnected'}>
              <span className="dot" />
              {!connected && <span className="label">Offline</span>}
            </span>
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
            <NewSessionDashboard
              projectPath={projectPath || null}
              usageStats={usageStats}
              pastSessions={pastSessions}
              onLoadSession={onLoadSession || (() => {})}
            />
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {streaming && toolLog.length > 0 && (
            <ToolLog events={toolLog} />
          )}
          {pendingQuestion && (
            <div className="user-question-prompt">
              {pendingQuestion.questions.map((q, qIndex) => (
                <div key={qIndex} className="question-block">
                  <div className="question-header">{q.header}</div>
                  <div className="question-text">{q.question}</div>
                  <div className="question-options">
                    {q.options.map((option, oIndex) => {
                      const selected = (questionSelections[qIndex] || []).includes(option.label);
                      return (
                        <button
                          key={oIndex}
                          className={`question-option ${selected ? 'selected' : ''}`}
                          onClick={() => {
                            setQuestionSelections(prev => {
                              const current = prev[qIndex] || [];
                              if (q.multiSelect) {
                                const next = selected
                                  ? current.filter(l => l !== option.label)
                                  : [...current, option.label];
                                return { ...prev, [qIndex]: next };
                              }
                              return { ...prev, [qIndex]: [option.label] };
                            });
                          }}
                        >
                          <span className="option-indicator">
                            {q.multiSelect ? (selected ? '☑' : '☐') : (selected ? '●' : '○')}
                          </span>
                          <span className="option-content">
                            <span className="option-label">{option.label}</span>
                            <span className="option-description">{option.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button
                className="question-submit"
                onClick={() => {
                  const responses = pendingQuestion.questions.map((q, i) => {
                    const sel = questionSelections[i] || [];
                    return `${q.header}: ${sel.join(', ') || 'No selection'}`;
                  });
                  onRespondToQuestion?.(responses.join('\n'));
                }}
                disabled={Object.keys(questionSelections).length === 0 ||
                          Object.values(questionSelections).every(s => s.length === 0)}
              >
                Confirm
              </button>
            </div>
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
          {uploadedImages.length > 0 && (
            <div className="uploaded-images-preview">
              {uploadedImages.map(img => (
                <div key={img.id} className="image-preview-item">
                  <img src={img.url} alt={img.filename} />
                  <button
                    className="remove-image-btn"
                    onClick={() => handleRemoveImage(img.id)}
                    aria-label="Remove image"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="input-row">
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
            </div>
            <div className="input-actions">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                multiple
                style={{ display: 'none' }}
              />
              <button
                className={`attach-btn ${uploading ? 'uploading' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                disabled={!connected || uploading}
                aria-label="Attach image"
                title="Attach image"
              >
                {uploading ? (
                  <div className="attach-spinner" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
              </button>
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
                  disabled={(!input.trim() && uploadedImages.length === 0) || !connected}
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
          {!streaming && (input.trim() || uploadedImages.length > 0) && (
            <div className="input-hint">
              <kbd className="kbd">Enter</kbd> to send, <kbd className="kbd">Shift+Enter</kbd> for new line
            </div>
          )}
        </div>
      </div>
    </>
  );
};
