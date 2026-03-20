import React, { useState, useRef, useEffect } from 'react';
import { Message, FileWithPath, ImageAttachment } from '../types';
import { SlashCommandAutocomplete } from './SlashCommandAutocomplete';
import { PathAutocomplete } from './PathAutocomplete';
import { useSkills } from '../hooks/useSkills';
import { useToast } from '../contexts/ToastContext';
import {
  shouldShowAutocomplete,
  findSlashCommandAtCursor,
  filterSkills,
  getAllSuggestions,
} from '../utils/slashCommands';
import './ChatInput.css';

export interface ScheduledTask {
  id: string;
  prompt: string;
  intervalMs: number;
  recurring: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
  paused: boolean;
}

interface ChatInputProps {
  connected: boolean;
  streaming: boolean;
  backgroundProcessing: boolean;
  onSendMessage: (content: string, workspace?: string, model?: string, imageIds?: string[], images?: ImageAttachment[]) => void;
  onCancel: () => void;
  sessionId?: string;
  projectPath?: string | null;
  messages: Message[];
  pendingInput?: string | null;
  onClearPendingInput?: () => void;
  rateLimitState?: { active: boolean; retryAfterMs: number } | null;
  promptSuggestions?: string[];
  scheduledTasks?: ScheduledTask[];
  onCreateScheduledTask?: (prompt: string, interval: string) => void;
  onDeleteScheduledTask?: (id: string) => void;
  onPauseScheduledTask?: (id: string) => void;
  onResumeScheduledTask?: (id: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  connected,
  streaming,
  backgroundProcessing,
  onSendMessage,
  onCancel,
  sessionId,
  projectPath,
  messages,
  pendingInput = null,
  onClearPendingInput,
  rateLimitState,
  promptSuggestions = [],
  scheduledTasks = [],
  onCreateScheduledTask,
  onDeleteScheduledTask,
  onPauseScheduledTask,
  onResumeScheduledTask,
}) => {
  const [input, setInput] = useState('');
  const inputDraftsRef = useRef<Record<string, string>>({});
  const previousSessionIdRef = useRef<string | undefined>(sessionId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const { skills } = useSkills();
  const { showToast } = useToast();
  const [uploadedImages, setUploadedImages] = useState<Array<{ id: string; filename: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const historyIndexRef = useRef<number>(-1);
  const savedDraftRef = useRef<string>('');
  const [showPathAutocomplete, setShowPathAutocomplete] = useState(false);
  const [pathAutocompleteIndex, setPathAutocompleteIndex] = useState(0);
  const [pathSuggestions, setPathSuggestions] = useState<Array<{ name: string; path: string; isDir: boolean }>>([]);
  const pathDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [currentPathToken, setCurrentPathToken] = useState<{ start: number; end: number; path: string } | null>(null);
  const currentSlashCommandRef = useRef<{ start: number; command: string } | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<{content: string, imageIds?: string[], images?: ImageAttachment[]} | null>(null);
  const queuedMessagesRef = useRef<Record<string, {content: string, imageIds?: string[], images?: ImageAttachment[]}>>({});

  // Handle pending input from "Send to new session"
  useEffect(() => {
    if (pendingInput && onClearPendingInput) {
      setInput(pendingInput);
      onClearPendingInput();
      // Focus textarea after setting input
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  }, [pendingInput, onClearPendingInput]);

  // Persist input drafts per session
  useEffect(() => {
    if (!sessionId) return;

    // Save current input to drafts map when session changes
    if (previousSessionIdRef.current && previousSessionIdRef.current !== sessionId) {
      const updatedDrafts = {
        ...inputDraftsRef.current,
        [previousSessionIdRef.current]: input,
      };

      // Cap the map size to prevent memory leak (keep only the 50 most recent drafts)
      const MAX_DRAFTS = 50;
      const draftEntries = Object.entries(updatedDrafts);
      if (draftEntries.length > MAX_DRAFTS) {
        // Remove oldest entries (simple FIFO approach)
        const excessCount = draftEntries.length - MAX_DRAFTS;
        const trimmedDrafts = Object.fromEntries(draftEntries.slice(excessCount));
        inputDraftsRef.current = trimmedDrafts;
      } else {
        inputDraftsRef.current = updatedDrafts;
      }

      // Restore input for new session (unless there's pending input)
      if (!pendingInput) {
        const savedDraft = inputDraftsRef.current[sessionId] || '';
        setInput(savedDraft);
      }
    }

    previousSessionIdRef.current = sessionId;
  }, [sessionId, input, pendingInput]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

  // Keep textarea always focused and ready for input
  useEffect(() => {
    const isTerminalActive = () => {
      const terminal = document.querySelector('.terminal-floating');
      return terminal && (terminal as HTMLElement).offsetParent !== null;
    };

    const focusTextarea = () => {
      if (isTerminalActive()) return;
      if (textareaRef.current) {
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
      if (target.closest('button') || target.closest('a') || target.closest('[contenteditable]') || target.closest('input') || target.closest('select') || target.closest('.project-picker') || target.closest('.terminal-floating')) {
        return;
      }
      // Don't steal focus if user has selected text
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
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
  }, [messages.length, streaming, connected, sessionId]);

  // Auto-send queued message when streaming ends
  useEffect(() => {
    if (!streaming && queuedMessage) {
      onSendMessage(queuedMessage.content, undefined, undefined, queuedMessage.imageIds, queuedMessage.images);
      setQueuedMessage(null);
      // Also clean up from ref map
      if (sessionId) {
        const { [sessionId]: _, ...rest } = queuedMessagesRef.current;
        queuedMessagesRef.current = rest;
      }
    }
  }, [streaming, queuedMessage, onSendMessage, sessionId]);

  // Persist queued messages per session on tab switch
  useEffect(() => {
    if (previousSessionIdRef.current && previousSessionIdRef.current !== sessionId) {
      // Save current queued message under old session
      if (queuedMessage) {
        queuedMessagesRef.current = {
          ...queuedMessagesRef.current,
          [previousSessionIdRef.current]: queuedMessage,
        };
      } else {
        // Clean up if no queued message
        const { [previousSessionIdRef.current]: _, ...rest } = queuedMessagesRef.current;
        queuedMessagesRef.current = rest;
      }

      // Restore queued message for new session (if any)
      const restored = sessionId ? queuedMessagesRef.current[sessionId] || null : null;
      setQueuedMessage(restored);
      if (restored && sessionId) {
        const { [sessionId]: _, ...rest } = queuedMessagesRef.current;
        queuedMessagesRef.current = rest;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // intentionally exclude queuedMessage to avoid loops

  const handleSubmit = () => {
    const trimmed = input.trim();
    if ((!trimmed && uploadedImages.length === 0) || !connected) return;

    // Check for /loop command
    if (trimmed.startsWith('/loop')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) {
        // Show usage hint
        showToast('/loop usage: /loop <interval> <prompt>\nExample: /loop 5m check the deploy', 'info');
        return;
      }

      const interval = parts[1];
      const prompt = parts.slice(2).join(' ');

      if (!onCreateScheduledTask) {
        showToast('Scheduled tasks not available', 'error');
        return;
      }

      // Validate interval format
      if (!/^\d+(s|m|h|d)$/.test(interval)) {
        showToast('Invalid interval format. Use: 30s, 5m, 2h, or 1d', 'error');
        return;
      }

      onCreateScheduledTask(prompt, interval);
      showToast(`Scheduled task created: "${prompt}" every ${interval}`, 'success');
      setInput('');
      setUploadedImages([]);
      historyIndexRef.current = -1;
      savedDraftRef.current = '';
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      if (sessionId) {
        inputDraftsRef.current = {
          ...inputDraftsRef.current,
          [sessionId]: '',
        };
      }
      return;
    }

    // If streaming and not background processing, queue the message instead of sending
    if (streaming && !backgroundProcessing) {
      const imageIds = uploadedImages.map(img => img.id);
      const images = uploadedImages.map(img => ({
        id: img.id,
        filename: img.filename,
        mime_type: 'image/png',
        size: 0,
        url: img.url,
      }));

      setQueuedMessage({
        content: trimmed || '[Image]',
        imageIds: imageIds.length > 0 ? imageIds : undefined,
        images: images.length > 0 ? images : undefined,
      });

      // Clear input and images to show user it was "sent"
      setInput('');
      setUploadedImages([]);
      setShowAutocomplete(false);
      historyIndexRef.current = -1;
      savedDraftRef.current = '';
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      if (sessionId) {
        inputDraftsRef.current = {
          ...inputDraftsRef.current,
          [sessionId]: '',
        };
      }
      return;
    }

    // Normal send flow (not streaming, or background processing)
    const imageIds = uploadedImages.map(img => img.id);
    const images = uploadedImages.map(img => ({
      id: img.id,
      filename: img.filename,
      mime_type: 'image/png',
      size: 0,
      url: img.url,
    }));
    onSendMessage(
      trimmed || '[Image]',
      undefined,
      undefined,
      imageIds.length > 0 ? imageIds : undefined,
      images.length > 0 ? images : undefined
    );
    setInput('');
    setUploadedImages([]);
    setShowAutocomplete(false);
    historyIndexRef.current = -1; // Reset history navigation
    savedDraftRef.current = ''; // Clear saved draft
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    // Clear draft for current session
    if (sessionId) {
      inputDraftsRef.current = {
        ...inputDraftsRef.current,
        [sessionId]: '',
      };
    }
  };

  const uploadFiles = async (files: File[]) => {
    setUploading(true);
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showToast('Please choose a PNG, JPG, GIF, or WebP image', 'error');
        continue;
      }

      if (file.size > 10 * 1024 * 1024) {
        showToast(`${file.name} is too large. Maximum file size is 10MB`, 'error');
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
        showToast(`Failed to upload ${file.name}. Please try again`, 'error');
      }
    }

    setUploading(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    await uploadFiles(Array.from(files));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (imageId: string) => {
    setUploadedImages(prev => prev.filter(img => img.id !== imageId));
  };

  // Get filtered autocomplete suggestions
  const getAutocompleteSuggestions = () => {
    const cursorPosition = textareaRef.current?.selectionStart || 0;
    const slashCmd = findSlashCommandAtCursor(input, cursorPosition);

    if (!slashCmd) return [];

    // Store the current slash command context for handleAutocompleteSelect
    currentSlashCommandRef.current = slashCmd;

    const allSuggestions = getAllSuggestions(skills);
    return filterSkills(allSuggestions, slashCmd.command);
  };

  const autocompleteSuggestions = getAutocompleteSuggestions();

  // Extract path token at cursor position
  const extractPathToken = (text: string, cursorPos: number): { start: number; end: number; path: string } | null => {
    // Find word boundaries around cursor
    let start = cursorPos;
    let end = cursorPos;

    // Scan backwards to find start of path token
    while (start > 0 && !/\s/.test(text[start - 1])) {
      start--;
    }

    // Scan forwards to find end of path token
    while (end < text.length && !/\s/.test(text[end])) {
      end++;
    }

    const token = text.slice(start, end);

    // Check if token looks like a path
    if (token.startsWith('~/') || token.startsWith('/') || token.startsWith('./')) {
      return { start, end, path: token };
    }

    return null;
  };

  // Fetch path completions
  const fetchPathCompletions = async (partialPath: string) => {
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
    try {
      let url = `${SOCKET_URL}/api/path-complete?partial=${encodeURIComponent(partialPath)}`;
      if (projectPath) {
        url += `&project=${encodeURIComponent(projectPath)}`;
      }
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      setPathSuggestions(data.entries || []);
      setPathAutocompleteIndex(0);
    } catch (error) {
      setPathSuggestions([]);
    }
  };

  // Handle input changes for autocomplete
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInput(newValue);

    const cursorPosition = e.target.selectionStart || 0;

    // Check for slash command autocomplete first (takes priority)
    const shouldShow = shouldShowAutocomplete(newValue, cursorPosition);
    if (shouldShow) {
      setShowAutocomplete(true);
      setAutocompleteIndex(0);
      setShowPathAutocomplete(false);
      return;
    } else {
      setShowAutocomplete(false);
    }

    // Check for path autocomplete
    const pathToken = extractPathToken(newValue, cursorPosition);
    if (pathToken) {
      setCurrentPathToken(pathToken);
      setShowPathAutocomplete(true);

      // Debounce API call
      if (pathDebounceRef.current) {
        clearTimeout(pathDebounceRef.current);
      }
      pathDebounceRef.current = setTimeout(() => {
        fetchPathCompletions(pathToken.path);
      }, 200);
    } else {
      setShowPathAutocomplete(false);
      setPathSuggestions([]);
      setCurrentPathToken(null);
      if (pathDebounceRef.current) {
        clearTimeout(pathDebounceRef.current);
      }
    }
  };

  // Handle autocomplete selection
  const handleAutocompleteSelect = (suggestion: { name: string }) => {
    const slashCmd = currentSlashCommandRef.current;
    if (!slashCmd) {
      // Fallback to old behavior
      setInput(`/${suggestion.name} `);
      setShowAutocomplete(false);
      textareaRef.current?.focus();
      return;
    }

    // Get cursor position to preserve text after cursor
    const cursorPosition = textareaRef.current?.selectionStart || 0;

    // Replace from slash start to cursor with the selected command
    const before = input.slice(0, slashCmd.start);
    const after = input.slice(cursorPosition);
    const newInput = before + `/${suggestion.name} ` + after;

    setInput(newInput);
    setShowAutocomplete(false);

    // Set cursor position after the inserted command
    const newCursorPos = slashCmd.start + suggestion.name.length + 2; // +2 for '/' and ' '
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current.focus();
      }
    }, 0);

    // Clear the ref
    currentSlashCommandRef.current = null;
  };

  // Handle path autocomplete selection
  const handlePathAutocompleteSelect = (entry: { name: string; path: string; isDir: boolean }) => {
    if (!currentPathToken) return;

    const before = input.slice(0, currentPathToken.start);
    const after = input.slice(currentPathToken.end);
    const newPath = entry.path;

    // If directory, append / and keep autocomplete open
    if (entry.isDir) {
      const newInput = before + newPath + '/' + after;
      setInput(newInput);

      // Update cursor position
      const newCursorPos = currentPathToken.start + newPath.length + 1;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.focus();
        }
      }, 0);

      // Fetch next level
      fetchPathCompletions(newPath + '/');
      setCurrentPathToken({ start: currentPathToken.start, end: newCursorPos, path: newPath + '/' });
    } else {
      // File selected - insert path and close autocomplete
      const newInput = before + newPath + ' ' + after;
      setInput(newInput);
      setShowPathAutocomplete(false);
      setPathSuggestions([]);
      setCurrentPathToken(null);

      // Update cursor position
      const newCursorPos = currentPathToken.start + newPath.length + 1;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.focus();
        }
      }, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle path autocomplete navigation
    if (showPathAutocomplete && pathSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPathAutocompleteIndex((prev) =>
          prev < pathSuggestions.length - 1 ? prev + 1 : prev
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPathAutocompleteIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const selected = pathSuggestions[pathAutocompleteIndex];
        if (selected) {
          handlePathAutocompleteSelect(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowPathAutocomplete(false);
        setPathSuggestions([]);
        setCurrentPathToken(null);
        return;
      }
    }

    // Handle slash command autocomplete navigation
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

    // Handle message history navigation with Up/Down arrows
    if (!showAutocomplete && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPosition = textarea.selectionStart || 0;
      const isAtStart = cursorPosition === 0;
      const isEmpty = input.trim() === '';

      // Extract user messages from history
      const userMessages = messages
        .filter(msg => msg.role === 'user')
        .map(msg => msg.content);

      if (userMessages.length === 0) return;

      // Up arrow: navigate to older messages
      if (e.key === 'ArrowUp' && (isEmpty || isAtStart)) {
        e.preventDefault();

        // Save current draft before entering history mode (first time only)
        if (historyIndexRef.current === -1) {
          savedDraftRef.current = input;
        }

        // Calculate new index (start from end of array, which is most recent)
        const newIndex = historyIndexRef.current === -1
          ? userMessages.length - 1
          : Math.max(0, historyIndexRef.current - 1);

        historyIndexRef.current = newIndex;
        setInput(userMessages[newIndex] || '');
        return;
      }

      // Down arrow: navigate to newer messages
      if (e.key === 'ArrowDown' && historyIndexRef.current !== -1) {
        e.preventDefault();

        const newIndex = historyIndexRef.current + 1;

        // If past the newest message, restore the saved draft
        if (newIndex >= userMessages.length) {
          historyIndexRef.current = -1;
          setInput(savedDraftRef.current);
          savedDraftRef.current = '';
        } else {
          historyIndexRef.current = newIndex;
          setInput(userMessages[newIndex] || '');
        }
        return;
      }
    }

    // Normal message sending (allow during background processing, queue during active streaming)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };


  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragOver to false if we're leaving the input-container entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const imageFiles: File[] = [];
    const paths: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i] as FileWithPath;

      if (file.type?.startsWith('image/')) {
        imageFiles.push(file);
      } else {
        const filePath = file.path;
        if (filePath) {
          paths.push(filePath);
        }
      }
    }

    if (imageFiles.length > 0) {
      await uploadFiles(imageFiles);
    }

    if (paths.length > 0) {
      const currentValue = input;
      const separator = currentValue && !currentValue.endsWith('\n') && !currentValue.endsWith(' ') ? '\n' : '';
      const newValue = currentValue + separator + paths.join('\n');
      setInput(newValue);
    }

    textareaRef.current?.focus();
  };

  return (
    <div
      className={`input-container ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {rateLimitState?.active && (
        <div className="rate-limit-indicator">
          Rate limited — retrying in {Math.ceil(rateLimitState.retryAfterMs / 1000)}s
        </div>
      )}
      {showAutocomplete && autocompleteSuggestions.length > 0 && (
        <SlashCommandAutocomplete
          suggestions={autocompleteSuggestions}
          selectedIndex={autocompleteIndex}
          onSelect={handleAutocompleteSelect}
          onClose={() => setShowAutocomplete(false)}
          inputRef={textareaRef}
        />
      )}
      {showPathAutocomplete && pathSuggestions.length > 0 && (
        <PathAutocomplete
          entries={pathSuggestions}
          selectedIndex={pathAutocompleteIndex}
          onSelect={handlePathAutocompleteSelect}
          onClose={() => {
            setShowPathAutocomplete(false);
            setPathSuggestions([]);
            setCurrentPathToken(null);
          }}
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
                aria-label={`Remove ${img.filename}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {promptSuggestions.length > 0 && !streaming && (
        <div className="prompt-suggestions">
          {promptSuggestions.map((suggestion, i) => (
            <button
              key={i}
              className="prompt-suggestion-chip"
              onClick={() => onSendMessage(suggestion)}
            >
              {suggestion}
            </button>
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
            placeholder={connected ? (streaming && !backgroundProcessing ? 'Type a message to queue...' : 'Send a message or type / for commands...') : 'Reconnecting — hang tight...'}
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
              <div className="attach-spinner" aria-hidden="true" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>
          {streaming && !backgroundProcessing ? (
            <>
              <button className="cancel-btn" onClick={onCancel} aria-label="Cancel streaming">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              </button>
              <button
                className="queue-send-btn"
                onClick={handleSubmit}
                disabled={(!input.trim() && uploadedImages.length === 0) || !connected}
                aria-label="Queue message"
                title="Queue for after response"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            </>
          ) : (
            <button
              className="send-btn"
              onClick={handleSubmit}
              disabled={(!input.trim() && uploadedImages.length === 0) || !connected}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {queuedMessage && (
        <div className="queued-message-indicator">
          <span className="queued-accent-bar" />
          <span className="queued-text">
            {queuedMessage.content.length > 80 ? queuedMessage.content.slice(0, 80) + '...' : queuedMessage.content}
          </span>
          <button className="queued-dismiss" onClick={() => setQueuedMessage(null)} aria-label="Cancel queued message">
            cancel
          </button>
        </div>
      )}
      {backgroundProcessing && !streaming && (
        <div className="background-processing-indicator">
          <span className="processing-dot"></span>
          <span className="processing-text">Background agents running...</span>
        </div>
      )}
    </div>
  );
};
