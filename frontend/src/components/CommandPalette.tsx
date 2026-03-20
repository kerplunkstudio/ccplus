import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectEntry } from '../types/workspace';
import './CommandPalette.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectEntry[];
  activeProjectPath: string | null;
  onSelectTab: (projectPath: string, sessionId: string) => void;
  onSelectProject: (projectPath: string) => void;
  onNewTab: () => void;
  onCloseTab: (sessionId: string) => void;
  onNavigate: (page: string) => void;
  onToggleActivityPanel?: () => void;
  onNewTerminalTab?: () => void;
  onOpenSession: (projectPath: string, sessionId: string, label: string) => void;
}

interface CommandItem {
  id: string;
  type: 'session' | 'project' | 'action' | 'history';
  iconType?: 'session-chat' | 'session-browser' | 'project' | 'action';
  name: string;
  subtitle?: string;
  shortcut?: string;
  action: () => void;
}

interface SearchMatch {
  content: string;
  role: string;
  timestamp: string;
}

interface SearchResult {
  session_id: string;
  session_label: string;
  matches: SearchMatch[];
}

function fuzzyMatch(query: string, text: string): { match: boolean; score: number; matchedIndices: number[] } {
  if (!query) {
    return { match: true, score: 0, matchedIndices: [] };
  }

  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const matchedIndices: number[] = [];
  let j = 0;
  let score = 0;
  let lastIndex = -1;

  for (let i = 0; i < lower.length && j < q.length; i++) {
    if (lower[i] === q[j]) {
      matchedIndices.push(i);
      // Consecutive character bonus
      score += (lastIndex >= 0 && i - lastIndex === 1) ? 2 : 1;
      // Start of word bonus
      if (i === 0 || lower[i - 1] === ' ' || lower[i - 1] === '-' || lower[i - 1] === '_') {
        score += 1;
      }
      lastIndex = i;
      j++;
    }
  }

  return { match: j === q.length, score, matchedIndices };
}

function highlightMatch(text: string, matchedIndices: number[]): React.ReactNode {
  if (matchedIndices.length === 0) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  matchedIndices.forEach((index, i) => {
    // Add text before match
    if (index > lastIndex) {
      parts.push(<span key={`text-${i}`}>{text.slice(lastIndex, index)}</span>);
    }
    // Add matched character
    parts.push(<mark key={`match-${i}`}>{text[index]}</mark>);
    lastIndex = index + 1;
  });

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key="text-end">{text.slice(lastIndex)}</span>);
  }

  return parts;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  projects,
  activeProjectPath,
  onSelectTab,
  onSelectProject,
  onNewTab,
  onCloseTab,
  onNavigate,
  onToggleActivityPanel,
  onNewTerminalTab,
  onOpenSession,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Perform search for session history
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const params = new URLSearchParams({ q: searchQuery });
      if (activeProjectPath) {
        params.append('project', activeProjectPath);
      }
      const response = await fetch(`${SOCKET_URL}/api/search?${params}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.results || []);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      setSearchResults([]);
    }
  }, [activeProjectPath]);

  // Debounced search effect
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(query);
      }, 300);
    } else {
      setSearchResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, performSearch]);

  // Build command items
  const buildItems = useCallback((): CommandItem[] => {
    const items: CommandItem[] = [];

    // Sessions (all tabs across all projects)
    projects.forEach((project) => {
      project.tabs.forEach((tab) => {
        items.push({
          id: `session-${project.path}-${tab.sessionId}`,
          type: 'session',
          iconType: tab.type === 'browser' ? 'session-browser' : 'session-chat',
          name: tab.label,
          subtitle: project.name,
          action: () => {
            onSelectTab(project.path, tab.sessionId);
            onClose();
          },
        });
      });
    });

    // Projects
    projects.forEach((project) => {
      items.push({
        id: `project-${project.path}`,
        type: 'project',
        iconType: 'project',
        name: project.name,
        subtitle: project.path,
        action: () => {
          onSelectProject(project.path);
          onClose();
        },
      });
    });

    // Actions
    const actions: CommandItem[] = [
      {
        id: 'action-new-session',
        type: 'action',
        iconType: 'action',
        name: 'New Session',
        shortcut: '⌘T',
        action: () => {
          onNewTab();
          onClose();
        },
      },
      {
        id: 'action-new-terminal',
        type: 'action',
        iconType: 'action',
        name: 'New Terminal',
        action: () => {
          if (onNewTerminalTab) {
            onNewTerminalTab();
          }
          onClose();
        },
      },
      {
        id: 'action-close-tab',
        type: 'action',
        iconType: 'action',
        name: 'Close Tab',
        shortcut: '⌘W',
        action: () => {
          // Close active tab (need to get it from activeProjectPath)
          const activeProject = projects.find((p) => p.path === activeProjectPath);
          if (activeProject) {
            const activeTab = activeProject.tabs.find((t) => t.sessionId === activeProject.activeTabId);
            if (activeTab) {
              onCloseTab(activeTab.sessionId);
            }
          }
          onClose();
        },
      },
      {
        id: 'action-toggle-activity',
        type: 'action',
        iconType: 'action',
        name: 'Toggle Activity Panel',
        action: () => {
          if (onToggleActivityPanel) {
            onToggleActivityPanel();
          }
          onClose();
        },
      },
      {
        id: 'action-insights',
        type: 'action',
        iconType: 'action',
        name: 'Open Insights',
        action: () => {
          onNavigate('insights');
          onClose();
        },
      },
      {
        id: 'action-settings',
        type: 'action',
        iconType: 'action',
        name: 'Open Settings',
        action: () => {
          onNavigate('profile');
          onClose();
        },
      },
      {
        id: 'action-plugins',
        type: 'action',
        iconType: 'action',
        name: 'Open Plugins',
        action: () => {
          onNavigate('mcp');
          onClose();
        },
      },
    ];

    items.push(...actions);

    // Add history results
    searchResults.forEach((result) => {
      // Check if session is already open in tabs
      const isAlreadyOpen = projects.some((project) =>
        project.tabs.some((tab) => tab.sessionId === result.session_id)
      );

      items.push({
        id: `history-${result.session_id}`,
        type: 'history',
        iconType: 'session-chat',
        name: result.session_label,
        subtitle: isAlreadyOpen
          ? 'Already open'
          : result.matches.length > 0
          ? result.matches[0].content.slice(0, 80)
          : undefined,
        action: () => {
          if (isAlreadyOpen) {
            // Find the project and switch to it
            const project = projects.find((p) =>
              p.tabs.some((t) => t.sessionId === result.session_id)
            );
            if (project) {
              onSelectTab(project.path, result.session_id);
            }
          } else {
            // Open as new tab
            if (activeProjectPath) {
              onOpenSession(activeProjectPath, result.session_id, result.session_label);
            }
          }
          onClose();
        },
      });
    });

    return items;
  }, [projects, activeProjectPath, searchResults, onSelectTab, onSelectProject, onNewTab, onCloseTab, onNavigate, onToggleActivityPanel, onNewTerminalTab, onOpenSession, onClose]);

  const allItems = buildItems();

  // Filter and sort items
  const filteredItems = query
    ? allItems
        .map((item) => {
          const match = fuzzyMatch(query, item.name);
          return { ...item, ...match };
        })
        .filter((item) => item.match)
        .sort((a, b) => {
          // Sort by score descending
          if (b.score !== a.score) return b.score - a.score;
          // Tie-break by type priority: actions > sessions > history > projects
          const typePriority = { action: 4, session: 3, history: 2, project: 1 };
          const priorityDiff = typePriority[b.type] - typePriority[a.type];
          if (priorityDiff !== 0) return priorityDiff;
          // Finally by name alphabetically
          return a.name.localeCompare(b.name);
        })
        .slice(0, 10)
    : allItems.slice(0, 10);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            filteredItems[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
    if (selectedElement && typeof selectedElement.scrollIntoView === 'function') {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Group items by category
  const sessions = filteredItems.filter((item) => item.type === 'session');
  const projectItems = filteredItems.filter((item) => item.type === 'project');
  const actionItems = filteredItems.filter((item) => item.type === 'action');
  const historyItems = filteredItems.filter((item) => item.type === 'history');

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          placeholder="Search sessions, history, projects, and actions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="command-palette-results" ref={resultsRef}>
          {filteredItems.length === 0 ? (
            <div className="command-palette-empty">No results found</div>
          ) : (
            <>
              {sessions.length > 0 && (
                <>
                  <div className="command-palette-category">Sessions</div>
                  {sessions.map((item, index) => {
                    const globalIndex = filteredItems.indexOf(item);
                    return (
                      <div
                        key={item.id}
                        className={`command-palette-item ${globalIndex === selectedIndex ? 'selected' : ''}`}
                        onClick={item.action}
                      >
                        <span className={`command-palette-icon icon-${item.iconType}`}></span>
                        <div className="command-palette-item-content">
                          <div className="command-palette-item-name">
                            {highlightMatch(item.name, (item as any).matchedIndices || [])}
                          </div>
                          {item.subtitle && (
                            <div className="command-palette-item-subtitle">{item.subtitle}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {projectItems.length > 0 && (
                <>
                  <div className="command-palette-category">Projects</div>
                  {projectItems.map((item, index) => {
                    const globalIndex = filteredItems.indexOf(item);
                    return (
                      <div
                        key={item.id}
                        className={`command-palette-item ${globalIndex === selectedIndex ? 'selected' : ''}`}
                        onClick={item.action}
                      >
                        <span className={`command-palette-icon icon-${item.iconType}`}></span>
                        <div className="command-palette-item-content">
                          <div className="command-palette-item-name">
                            {highlightMatch(item.name, (item as any).matchedIndices || [])}
                          </div>
                          {item.subtitle && (
                            <div className="command-palette-item-subtitle">{item.subtitle}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {historyItems.length > 0 && (
                <>
                  <div className="command-palette-category">History</div>
                  {historyItems.map((item, index) => {
                    const globalIndex = filteredItems.indexOf(item);
                    return (
                      <div
                        key={item.id}
                        className={`command-palette-item ${globalIndex === selectedIndex ? 'selected' : ''}`}
                        onClick={item.action}
                      >
                        <span className={`command-palette-icon icon-${item.iconType}`}></span>
                        <div className="command-palette-item-content">
                          <div className="command-palette-item-name">
                            {highlightMatch(item.name, (item as any).matchedIndices || [])}
                          </div>
                          {item.subtitle && (
                            <div className="command-palette-item-subtitle">{item.subtitle}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {actionItems.length > 0 && (
                <>
                  <div className="command-palette-category">Actions</div>
                  {actionItems.map((item, index) => {
                    const globalIndex = filteredItems.indexOf(item);
                    return (
                      <div
                        key={item.id}
                        className={`command-palette-item ${globalIndex === selectedIndex ? 'selected' : ''}`}
                        onClick={item.action}
                      >
                        <span className={`command-palette-icon icon-${item.iconType}`}></span>
                        <div className="command-palette-item-content">
                          <div className="command-palette-item-name">
                            {highlightMatch(item.name, (item as any).matchedIndices || [])}
                          </div>
                        </div>
                        {item.shortcut && (
                          <span className="command-palette-shortcut">{item.shortcut}</span>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
