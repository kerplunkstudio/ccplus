import React from 'react';
import './PluginButton.css';

interface PluginButtonProps {
  onClick: () => void;
}

export const PluginButton: React.FC<PluginButtonProps> = ({ onClick }) => {
  return (
    <button
      className="plugin-button"
      onClick={onClick}
      title="Plugin Marketplace"
      aria-label="Open plugin marketplace"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12h14" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </svg>
    </button>
  );
};
