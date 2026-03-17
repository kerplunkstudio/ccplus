import React from 'react';
import { ModelSelector } from './ModelSelector';
import { PluginButton } from './PluginButton';
import './ChatPanelHeader.css';

interface ChatPanelHeaderProps {
  connected: boolean;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onToggleSessions?: () => void;
  onToggleActivity?: () => void;
  onOpenPluginModal: () => void;
}

export const ChatPanelHeader: React.FC<ChatPanelHeaderProps> = ({
  connected,
  selectedModel,
  onSelectModel,
  onToggleSessions,
  onToggleActivity,
  onOpenPluginModal,
}) => {
  return (
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
        <PluginButton onClick={onOpenPluginModal} />
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
  );
};
