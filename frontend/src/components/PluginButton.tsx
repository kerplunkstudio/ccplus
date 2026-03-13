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
      title="Plugin Marketplace — Browse skills and extend Claude"
      aria-label="Open plugin marketplace"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    </button>
  );
};
