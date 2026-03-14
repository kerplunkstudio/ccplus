import React from 'react';
import { TabState } from '../types';
import './TabBar.css';

interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onSelectTab: (sessionId: string) => void;
  onNewTab: () => void;
  onCloseTab: (sessionId: string) => void;
}

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onNewTab,
  onCloseTab,
}) => {
  const handleTabClick = (sessionId: string) => {
    onSelectTab(sessionId);
  };

  const handleCloseClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    onCloseTab(sessionId);
  };

  const isOnlyTab = tabs.length === 1;

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((tab) => {
          const isActive = tab.sessionId === activeTabId;
          const showActivity = tab.isStreaming || tab.hasRunningAgent;
          const showClose = !isActive || !isOnlyTab;

          return (
            <button
              key={tab.sessionId}
              className={`tab-item ${isActive ? 'active' : ''}`}
              onClick={() => handleTabClick(tab.sessionId)}
            >
              {showActivity && <span className="tab-item-dot" />}
              <span className="tab-item-label">{tab.label}</span>
              {showClose && (
                <button
                  className="tab-item-close"
                  onClick={(e) => handleCloseClick(e, tab.sessionId)}
                  aria-label="Close tab"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              )}
            </button>
          );
        })}
        <button
          className="tab-new-btn"
          onClick={onNewTab}
          aria-label="New tab"
        >
          +
        </button>
      </div>
    </div>
  );
};

export default TabBar;
