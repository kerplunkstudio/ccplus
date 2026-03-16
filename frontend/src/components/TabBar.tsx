import React, { useState, useEffect, useRef } from 'react';
import { TabState } from '../types';
import './TabBar.css';

interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onSelectTab: (sessionId: string) => void;
  onNewTab: () => void;
  onCloseTab: (sessionId: string) => void;
  onReopenTab: () => void;
  onCloseOtherTabs: (sessionId: string) => void;
  hasClosedTabs: boolean;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  sessionId: string;
}

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onReopenTab,
  onCloseOtherTabs,
  hasClosedTabs,
}) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    sessionId: '',
  });
  const menuRef = useRef<HTMLDivElement>(null);

  const handleTabClick = (sessionId: string) => {
    onSelectTab(sessionId);
  };

  const handleCloseClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    onCloseTab(sessionId);
  };

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      sessionId,
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, sessionId: '' });
  };

  const handleMenuCloseTab = () => {
    onCloseTab(contextMenu.sessionId);
    closeContextMenu();
  };

  const handleMenuReopenTab = () => {
    onReopenTab();
    closeContextMenu();
  };

  const handleMenuCloseOthers = () => {
    onCloseOtherTabs(contextMenu.sessionId);
    closeContextMenu();
  };

  // Close menu on click outside, scroll, or Escape
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    const handleScroll = () => {
      closeContextMenu();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu.visible]);

  const isOnlyTab = tabs.length === 1;

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((tab) => {
          const isActive = tab.sessionId === activeTabId;
          const showActivity = tab.isStreaming || tab.hasRunningAgent;
          const showClose = !isActive || !isOnlyTab;

          const isBrowserTab = tab.type === 'browser';

          return (
            <button
              key={tab.sessionId}
              className={`tab-item ${isActive ? 'active' : ''}`}
              onClick={() => handleTabClick(tab.sessionId)}
              onContextMenu={(e) => handleContextMenu(e, tab.sessionId)}
            >
              {showActivity && <span className="tab-item-dot" />}
              {isBrowserTab && (
                <svg
                  className="tab-item-icon"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              )}
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

      {contextMenu.visible && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <button
            className="tab-context-menu-item"
            onClick={handleMenuCloseTab}
          >
            Close Tab
          </button>
          <button
            className="tab-context-menu-item"
            onClick={handleMenuReopenTab}
            disabled={!hasClosedTabs}
          >
            Reopen Closed Tab
          </button>
          <button
            className="tab-context-menu-item"
            onClick={handleMenuCloseOthers}
            disabled={isOnlyTab}
          >
            Close Other Tabs
          </button>
        </div>
      )}
    </div>
  );
};

export default TabBar;
