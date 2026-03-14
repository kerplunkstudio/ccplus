import React, { useState, useEffect, useRef, useCallback } from 'react';
import './EnhancedMessageInput.css';

interface EnhancedMessageInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled: boolean;
  streaming: boolean;
  connected: boolean;
  onCancel: () => void;
}

export const EnhancedMessageInput: React.FC<EnhancedMessageInputProps> = ({
  value,
  onChange,
  onKeyDown,
  onSubmit,
  placeholder,
  disabled,
  streaming,
  connected,
  onCancel
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [submitPulse, setSubmitPulse] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value]);

  // Handle typing indication
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e);

    if (!isTyping) setIsTyping(true);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
  }, [onChange, isTyping]);

  // Handle submit with animation
  const handleSubmit = useCallback(() => {
    setSubmitPulse(true);
    setTimeout(() => setSubmitPulse(false), 200);
    onSubmit();
  }, [onSubmit]);

  // Focus management
  const handleFocus = () => setIsFocused(true);
  const handleBlur = () => setIsFocused(false);

  const canSubmit = value.trim() && connected && !streaming;

  return (
    <div className="enhanced-input-container">
      <div className={`input-wrapper-enhanced ${isFocused ? 'focused' : ''} ${isTyping ? 'typing' : ''}`}>
        {/* Background animation for focus */}
        <div className="input-background" />

        {/* Typing indicator line */}
        <div className={`typing-line ${isTyping ? 'active' : ''}`} />

        <textarea
          ref={textareaRef}
          className="message-input-enhanced"
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
        />

        {/* Action button */}
        {streaming ? (
          <button
            className="action-btn cancel-btn-enhanced"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <div className="btn-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
            </div>
          </button>
        ) : (
          <button
            className={`action-btn send-btn-enhanced ${submitPulse ? 'pulse' : ''} ${canSubmit ? 'ready' : 'disabled'}`}
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="Send"
          >
            <div className="btn-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </div>
            <div className="btn-ripple" />
          </button>
        )}
      </div>

      {/* Input hints */}
      {!streaming && value.trim() && (
        <div className="input-hint-enhanced">
          <div className="hint-item">
            <kbd className="kbd-enhanced">⏎</kbd>
            <span>Send</span>
          </div>
          <div className="hint-separator">•</div>
          <div className="hint-item">
            <kbd className="kbd-enhanced">⇧⏎</kbd>
            <span>New line</span>
          </div>
        </div>
      )}

      {/* Connection status indicator */}
      <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
        <div className="status-dot" />
        <span>{connected ? 'Connected' : 'Reconnecting...'}</span>
      </div>
    </div>
  );
};