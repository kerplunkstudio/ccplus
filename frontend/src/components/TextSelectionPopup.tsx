import React, { useState, useEffect, useCallback, useRef } from 'react';
import './TextSelectionPopup.css';

interface TextSelectionPopupProps {
  onSendToNewSession: (text: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const TextSelectionPopup: React.FC<TextSelectionPopupProps> = ({
  onSendToNewSession,
  containerRef,
}) => {
  const [selectedText, setSelectedText] = useState<string>('');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const updateSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !containerRef.current) {
      setSelectedText('');
      setPosition(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setSelectedText('');
      setPosition(null);
      return;
    }

    // Check if selection is within the messages container
    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectedText('');
      setPosition(null);
      return;
    }

    setSelectedText(text);

    // Calculate position for the popup
    try {
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Position popup above the selection, centered
      const top = rect.top - containerRect.top - 45; // 45px above selection
      const left = rect.left - containerRect.left + (rect.width / 2);

      setPosition({ top, left });
    } catch (error) {
      // Fallback for environments that don't support getBoundingClientRect on ranges (e.g., jsdom)
      setPosition({ top: 0, left: 0 });
    }
  }, [containerRef]);

  useEffect(() => {
    const handleSelectionChange = () => {
      // Use setTimeout to ensure selection has been updated
      setTimeout(updateSelection, 10);
    };

    const handleMouseUp = () => {
      // Update selection on mouse up (when user finishes selecting)
      setTimeout(updateSelection, 10);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updateSelection]);

  const handleSendToNewSession = useCallback(() => {
    if (selectedText) {
      onSendToNewSession(selectedText);
      // Clear selection
      window.getSelection()?.removeAllRanges();
      setSelectedText('');
      setPosition(null);
    }
  }, [selectedText, onSendToNewSession]);

  if (!selectedText || !position) {
    return null;
  }

  return (
    <div
      ref={popupRef}
      className="text-selection-popup"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <button
        className="text-selection-popup-button"
        onClick={handleSendToNewSession}
        onMouseDown={(e) => {
          // Prevent default to avoid losing selection
          e.preventDefault();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Send to new session
      </button>
    </div>
  );
};
