import React, { useState, useEffect, useRef } from 'react';
import { TabState } from '../types';
import './TabBar.css';

interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onSelectTab: (sessionId: string) => void;
  onNewTab: () => void;
  onNewTerminalTab: () => void;
  onCloseTab: (sessionId: string) => void;
  onReopenTab: () => void;
  onCloseOtherTabs: (sessionId: string) => void;
  onDuplicateTab: (sessionId: string) => void;
  onRenameTab: (sessionId: string, newLabel: string) => void;
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
  onNewTerminalTab,
  onCloseTab,
  onReopenTab,
  onCloseOtherTabs,
  onDuplicateTab,
  onRenameTab,
  hasClosedTabs,
}) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    sessionId: '',
  });
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newTabDropdownVisible, setNewTabDropdownVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const newTabMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastClickTimeRef = useRef<number>(0);

  const handleTabClick = (sessionId: string) => {
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;

    // Detect double-click (within 300ms)
    if (timeSinceLastClick < 300 && sessionId === activeTabId) {
      // Start editing mode
      const tab = tabs.find(t => t.sessionId === sessionId);
      if (tab) {
        setEditingTabId(sessionId);
        setEditValue(tab.label);
      }
    } else {
      // Single click - select tab
      onSelectTab(sessionId);
    }

    lastClickTimeRef.current = now;
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

  const handleMenuDuplicateTab = () => {
    onDuplicateTab(contextMenu.sessionId);
    closeContextMenu();
  };

  const commitRename = () => {
    if (editingTabId && editValue.trim() !== '') {
      const trimmedValue = editValue.trim();
      onRenameTab(editingTabId, trimmedValue);
    }
    setEditingTabId(null);
    setEditValue('');
  };

  const cancelRename = () => {
    setEditingTabId(null);
    setEditValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelRename();
    }
  };

  const handleRenameBlur = () => {
    commitRename();
  };

  const handleNewTabMenuClick = (type: 'session' | 'terminal') => {
    if (type === 'session') {
      onNewTab();
    } else {
      onNewTerminalTab();
    }
    setNewTabDropdownVisible(false);
  };

  // Close menu on click outside, scroll, or Escape
  useEffect(() => {
    if (!contextMenu.visible && !newTabDropdownVisible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenu.visible && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
      if (newTabDropdownVisible && newTabMenuRef.current && !newTabMenuRef.current.contains(e.target as Node)) {
        setNewTabDropdownVisible(false);
      }
    };

    const handleScroll = () => {
      closeContextMenu();
      setNewTabDropdownVisible(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        setNewTabDropdownVisible(false);
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
  }, [contextMenu.visible, newTabDropdownVisible]);

  // Auto-focus and select input when entering edit mode
  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const isOnlyTab = tabs.length === 1;

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((tab) => {
          const isActive = tab.sessionId === activeTabId;
          const showActivity = tab.isStreaming || tab.hasRunningAgent;
          const showClose = !isActive || !isOnlyTab;

          const isBrowserTab = tab.type === 'browser';
          const isTerminalTab = tab.type === 'terminal';

          const isEditing = editingTabId === tab.sessionId;

          return (
            <div
              key={tab.sessionId}
              className={`tab-item ${isActive ? 'active' : ''} ${isEditing ? 'editing' : ''}`}
              onClick={() => !isEditing && handleTabClick(tab.sessionId)}
              onContextMenu={(e) => handleContextMenu(e, tab.sessionId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleTabClick(tab.sessionId);
                }
              }}
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
              {isTerminalTab && (
                <svg
                  className="tab-item-icon"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              )}
              {isEditing ? (
                <input
                  ref={inputRef}
                  type="text"
                  className="tab-rename-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={handleRenameBlur}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Rename tab"
                />
              ) : (
                <span className="tab-item-label">{tab.label}</span>
              )}
              {showClose && !isEditing && (
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
            </div>
          );
        })}
        <div style={{ position: 'relative' }}>
          <button
            className="tab-new-btn"
            onClick={() => setNewTabDropdownVisible(!newTabDropdownVisible)}
            aria-label="New tab"
          >
            +
          </button>
          {newTabDropdownVisible && (
            <div
              ref={newTabMenuRef}
              className="tab-new-dropdown"
            >
              <button
                className="tab-context-menu-item"
                onClick={() => handleNewTabMenuClick('session')}
              >
                New Session
              </button>
              <button
                className="tab-context-menu-item"
                onClick={() => handleNewTabMenuClick('terminal')}
              >
                New Terminal
              </button>
            </div>
          )}
        </div>
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
            onClick={handleMenuDuplicateTab}
          >
            Duplicate Tab
          </button>
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
