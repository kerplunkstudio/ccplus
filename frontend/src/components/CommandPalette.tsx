import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectEntry, TabState } from '../types/workspace';
import './CommandPalette.css';

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
}

interface CommandItem {
  id: string;
  type: 'session' | 'project' | 'action';
  icon: string;
  name: string;
  subtitle?: string;
  shortcut?: string;
  action: () => void;
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
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Build command items
  const buildItems = useCallback((): CommandItem[] => {
    const items: CommandItem[] = [];

    // Sessions (all tabs across all projects)
    projects.forEach((project) => {
      project.tabs.forEach((tab) => {
        items.push({
          id: `session-${project.path}-${tab.sessionId}`,
          type: 'session',
          icon: tab.type === 'browser' ? '🌐' : '💬',
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
        icon: '📁',
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
        icon: '⚡',
        name: 'New Session',
        shortcut: '⌘T',
        action: () => {
          onNewTab();
          onClose();
        },
      },
      {
        id: 'action-close-tab',
        type: 'action',
        icon: '⚡',
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
        icon: '⚡',
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
        icon: '⚡',
        name: 'Open Insights',
        action: () => {
          onNavigate('insights');
          onClose();
        },
      },
      {
        id: 'action-settings',
        type: 'action',
        icon: '⚡',
        name: 'Open Settings',
        action: () => {
          onNavigate('profile');
          onClose();
        },
      },
      {
        id: 'action-plugins',
        type: 'action',
        icon: '⚡',
        name: 'Open Plugins',
        action: () => {
          onNavigate('mcp');
          onClose();
        },
      },
    ];

    items.push(...actions);

    return items;
  }, [projects, activeProjectPath, onSelectTab, onSelectProject, onNewTab, onCloseTab, onNavigate, onToggleActivityPanel, onClose]);

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
          // Tie-break by type priority: actions > sessions > projects
          const typePriority = { action: 3, session: 2, project: 1 };
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

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          placeholder="Search sessions, projects, and actions..."
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
                        <span className="command-palette-icon">{item.icon}</span>
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
                        <span className="command-palette-icon">{item.icon}</span>
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
                        <span className="command-palette-icon">{item.icon}</span>
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
