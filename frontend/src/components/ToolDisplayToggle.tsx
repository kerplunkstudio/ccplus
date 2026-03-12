import React from 'react';
import { ToolDisplayMode } from '../types';
import './ToolDisplayToggle.css';

interface ToolDisplayToggleProps {
  mode: ToolDisplayMode;
  onToggle: (mode: ToolDisplayMode) => void;
}

export const ToolDisplayToggle: React.FC<ToolDisplayToggleProps> = ({ mode, onToggle }) => {
  const handleToggle = () => {
    onToggle(mode === 'minimal' ? 'verbose' : 'minimal');
  };

  return (
    <button
      className="tool-display-toggle"
      onClick={handleToggle}
      aria-label={mode === 'minimal' ? 'Minimal tool display' : 'Verbose tool display'}
      title={mode === 'minimal' ? 'Minimal tool display' : 'Verbose tool display'}
    >
      {mode === 'minimal' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6" />
          <path d="M9 15h6" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      )}
    </button>
  );
};
