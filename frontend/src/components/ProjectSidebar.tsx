import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectEntry } from '../types';
import { WorkspaceBrowser } from './WorkspaceBrowser';
import { useToast } from '../contexts/ToastContext';
import './ProjectSidebar.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface AvailableProject {
  name: string;
  path: string;
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

interface ProjectSidebarProps {
  projects: ProjectEntry[];
  activeProjectPath: string | null;
  activeTabId: string | null;
  onSelectProject: (path: string) => void;
  onSelectTab: (projectPath: string, sessionId: string) => void;
  onAddProject: (path: string, name: string) => void;
  onRemoveProject: (path: string) => void;
  onNewTabForProject: (projectPath: string) => void;
  onCloseTab: (projectPath: string, sessionId: string) => void;
  onRenameTab: (projectPath: string, sessionId: string, newLabel: string) => void;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  onNavigate: (page: string) => void;
  activePage: string | null;
  version?: string | null;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const EXPANDED_KEY = 'ccplus_sidebar_expanded';

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  activeProjectPath,
  activeTabId,
  onSelectProject,
  onSelectTab,
  onAddProject,
  onRemoveProject,
  onNewTabForProject,
  onCloseTab,
  onRenameTab,
  sidebarWidth,
  onSidebarWidthChange,
  onNavigate,
  activePage,
  version,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [showWorkspaceBrowser, setShowWorkspaceBrowser] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<AvailableProject[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(EXPANDED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const { showToast } = useToast();

  const pickerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number>(0);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sessionClickTimeRef = useRef<{ [key: string]: number }>({});

  // Auto-expand active project on mount
  useEffect(() => {
    if (activeProjectPath && !expandedProjects.has(activeProjectPath)) {
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(activeProjectPath);
        return next;
      });
    }
  }, [activeProjectPath, expandedProjects]);

  // Persist expanded state to localStorage
  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(expandedProjects)));
  }, [expandedProjects]);

  // Auto-focus and select input when entering edit mode
  useEffect(() => {
    if (editingSessionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingSessionId]);

  // Drag resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = e.clientX;
    document.body.classList.add('sidebar-resizing');
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartRef.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, sidebarWidth + delta));
      onSidebarWidthChange(newWidth);
      dragStartRef.current = e.clientX;
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.classList.remove('sidebar-resizing');
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, sidebarWidth, onSidebarWidthChange]);

  useEffect(() => {
    if (!showPicker) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowPicker(false);
        setFilterQuery('');
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowPicker(false);
        setFilterQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showPicker]);

  const isGitHubUrl = (text: string): boolean => {
    const githubPattern = /^(https?:\/\/github\.com\/|git@github\.com:)[\w\-]+\/[\w\-]+(?:\.git)?$/;
    return githubPattern.test(text.trim());
  };

  const cloneGitHubRepo = async (url: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${SOCKET_URL}/api/projects/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        handleSelectProject(data.path, data.name);
      } else {
        const errorData = await response.json();
        showToast(`Failed to clone repository: ${errorData.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      showToast(`Failed to clone repository: ${error}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAvailableProjects = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${SOCKET_URL}/api/projects`);
      if (response.ok) {
        const data = await response.json();
        setAvailableProjects(data.projects || []);
      }
    } catch (error) {
      setAvailableProjects([]);
    } finally {
      setIsLoading(false);
    }
  };

  const performSearch = useCallback(async (query: string) => {
    if (!query || query.trim().length === 0) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams({ q: query });
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
    } finally {
      setIsSearching(false);
    }
  }, [activeProjectPath]);

  // Debounced search effect
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.trim().length > 0) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(searchQuery);
      }, 300);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, performSearch]);

  const handleOpenPicker = () => {
    setShowPicker(true);
    fetchAvailableProjects();
  };

  const handleFilterInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const trimmedQuery = filterQuery.trim();
      if (isGitHubUrl(trimmedQuery)) {
        cloneGitHubRepo(trimmedQuery);
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setShowPicker(false);
      setFilterQuery('');
    }
  };

  const handleSelectProject = (path: string, name: string) => {
    onAddProject(path, name);
    setShowPicker(false);
    setFilterQuery('');
  };

  const handleSelectWorkspace = async (path: string) => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/set-workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (response.ok) {
        // Workspace updated, now add as a project
        const name = path.split('/').pop() || 'Project';
        onAddProject(path, name);
        setShowWorkspaceBrowser(false);
      } else {
        const errorData = await response.json();
        showToast(`Failed to set workspace: ${errorData.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      showToast(`Failed to set workspace: ${error}`, 'error');
    }
  };

  const handleRemoveProject = (event: React.MouseEvent, path: string) => {
    event.stopPropagation();
    onRemoveProject(path);
  };

  const handleToggleProject = (event: React.MouseEvent | React.KeyboardEvent, path: string) => {
    event.stopPropagation();
    onSelectProject(path);
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleNewTab = (event: React.MouseEvent, projectPath: string) => {
    event.stopPropagation();
    onNewTabForProject(projectPath);
  };

  const handleCloseSession = (event: React.MouseEvent, projectPath: string, sessionId: string) => {
    event.stopPropagation();
    onCloseTab(projectPath, sessionId);
  };

  const handleSelectSession = (projectPath: string, sessionId: string) => {
    const now = Date.now();
    const lastClickTime = sessionClickTimeRef.current[sessionId] || 0;
    const timeSinceLastClick = now - lastClickTime;

    // Detect double-click (within 300ms) on the same session
    if (timeSinceLastClick < 300 && sessionId === activeTabId && projectPath === activeProjectPath) {
      // Start editing mode
      const project = projects.find(p => p.path === projectPath);
      const tab = project?.tabs.find(t => t.sessionId === sessionId);
      if (tab) {
        setEditingSessionId(sessionId);
        setEditValue(tab.label);
      }
    } else {
      // Single click - select session
      onSelectProject(projectPath);
      onSelectTab(projectPath, sessionId);
    }

    sessionClickTimeRef.current[sessionId] = now;
  };

  const commitSessionRename = (projectPath: string) => {
    if (editingSessionId && editValue.trim() !== '') {
      const trimmedValue = editValue.trim();
      onRenameTab(projectPath, editingSessionId, trimmedValue);
    }
    setEditingSessionId(null);
    setEditValue('');
  };

  const cancelSessionRename = () => {
    setEditingSessionId(null);
    setEditValue('');
  };

  const handleSessionRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, projectPath: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commitSessionRename(projectPath);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelSessionRename();
    }
  };

  const handleSessionRenameBlur = (projectPath: string) => {
    commitSessionRename(projectPath);
  };

  const handleSearchResultClick = (sessionId: string) => {
    // Find the project that contains this session
    const project = projects.find(p =>
      p.tabs.some(tab => tab.sessionId === sessionId)
    );

    if (project) {
      handleSelectSession(project.path, sessionId);
    } else if (activeProjectPath) {
      // Open the session as a new tab in the active project
      onSelectTab(activeProjectPath, sessionId);
    }

    // Clear search after navigating
    setSearchQuery('');
  };

  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query) return text;

    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, index) => {
      if (part.toLowerCase() === query.toLowerCase()) {
        return <mark key={index} className="search-highlight">{part}</mark>;
      }
      return <span key={index}>{part}</span>;
    });
  };

  const isProjectActive = (projectPath: string): boolean => {
    return projectPath === activeProjectPath;
  };

  const isSessionActive = (projectPath: string, sessionId: string): boolean => {
    return projectPath === activeProjectPath && sessionId === activeTabId;
  };

  const hasRunningActivity = (project: ProjectEntry): boolean => {
    return project.tabs.some(tab => tab.isStreaming || tab.hasRunningAgent);
  };

  const isExpanded = (projectPath: string): boolean => {
    // Auto-expand when searching
    if (searchQuery) return true;
    return expandedProjects.has(projectPath);
  };

  const filteredProjects = availableProjects.filter(project => {
    const isAlreadyOpen = projects.some(p => p.path === project.path);
    const matchesFilter = project.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
                         project.path.toLowerCase().includes(filterQuery.toLowerCase());
    return !isAlreadyOpen && matchesFilter;
  });

  const matchesSearchQuery = useCallback((label: string): boolean => {
    if (!searchQuery) return true;
    return label.toLowerCase().includes(searchQuery.toLowerCase());
  }, [searchQuery]);

  const hasMatchingSessions = useCallback((project: ProjectEntry): boolean => {
    if (!searchQuery) return true;
    return project.tabs.some(tab => matchesSearchQuery(tab.label));
  }, [searchQuery, matchesSearchQuery]);

  return (
    <div className="project-sidebar">
      {showWorkspaceBrowser && (
        <WorkspaceBrowser
          onSelectWorkspace={handleSelectWorkspace}
          onClose={() => setShowWorkspaceBrowser(false)}
        />
      )}

      <div className="project-sidebar-header">
        <h1 className="sidebar-brand-title">CC+</h1>
      </div>

      <div className="sidebar-search">
        <input
          type="text"
          className="sidebar-search-input"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="sidebar-search-clear"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div className="project-list">
        {searchQuery && searchResults.length > 0 ? (
          <div className="search-results">
            <div className="search-results-header">
              {searchResults.reduce((acc, r) => acc + r.matches.length, 0)} results across {searchResults.length} sessions
            </div>
            {searchResults.map((result, resultIndex) => (
              <div
                key={result.session_id}
                className="search-result-group"
                style={{ animationDelay: `${resultIndex * 30}ms` }}
              >
                <div className="search-result-session-header">
                  {result.session_label.length > 60
                    ? result.session_label.slice(0, 60) + '...'
                    : result.session_label}
                </div>
                {result.matches.map((match, matchIndex) => (
                  <div
                    key={`${result.session_id}-${matchIndex}`}
                    className="search-result-item"
                    onClick={() => handleSearchResultClick(result.session_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSearchResultClick(result.session_id);
                      }
                    }}
                  >
                    <div className="search-result-content">
                      {highlightMatch(match.content, searchQuery)}
                    </div>
                    <div className="search-result-meta">
                      <span className="search-result-role">{match.role}</span>
                      <span className="search-result-timestamp">
                        {new Date(match.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : searchQuery && !isSearching && searchResults.length === 0 ? (
          <div className="search-empty-state">
            No results for &apos;{searchQuery}&apos;
          </div>
        ) : projects.length === 0 ? (
          <div className="project-empty-state">
            <p className="project-empty-message">No projects open</p>
            <button
              className="project-empty-cta"
              onClick={handleOpenPicker}
              aria-label="Add a project"
            >
              + Add a project
            </button>
          </div>
        ) : (
          projects
            .filter(hasMatchingSessions)
            .map(project => {
              const expanded = isExpanded(project.path);
              const hasActivity = hasRunningActivity(project);

              // Render simplified single-row for projects with no tabs
              if (project.tabs.length === 0) {
                return (
                  <div key={project.path} className="sb-project-group">
                    <div
                      className="sb-project-header sb-project-header-no-tabs"
                      onMouseEnter={() => setHoveredProject(project.path)}
                      onMouseLeave={() => setHoveredProject(null)}
                      onClick={() => onSelectProject(project.path)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectProject(project.path);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Project: ${project.name}`}
                    >
                      <span className="sb-project-header-name" title={project.path}>
                        {project.name}
                      </span>
                      {hoveredProject === project.path && (
                        <>
                          <button
                            className="sb-project-header-new"
                            onClick={(e) => handleNewTab(e, project.path)}
                            aria-label="New session"
                            title="New session"
                          >
                            +
                          </button>
                          <button
                            className="sb-project-header-close"
                            onClick={(e) => handleRemoveProject(e, project.path)}
                            aria-label={`Close ${project.name}`}
                            title="Close project"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              }

              // Normal rendering for projects with tabs
              return (
                <div key={project.path} className="sb-project-group">
                  <div
                    className="sb-project-header"
                    onMouseEnter={() => setHoveredProject(project.path)}
                    onMouseLeave={() => setHoveredProject(null)}
                    onClick={(e) => handleToggleProject(e, project.path)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggleProject(e, project.path);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                  >
                    <span className={`sb-chevron ${expanded ? 'expanded' : ''}`}>
                      ▸
                    </span>
                    <span className="sb-project-header-name" title={project.path}>
                      {project.name}
                    </span>
                    {!expanded && hasActivity && (
                      <span className="sb-activity-dot" />
                    )}
                    {hoveredProject === project.path && (
                      <>
                        <button
                          className="sb-project-header-new"
                          onClick={(e) => handleNewTab(e, project.path)}
                          aria-label="New session"
                          title="New session"
                        >
                          +
                        </button>
                        <button
                          className="sb-project-header-close"
                          onClick={(e) => handleRemoveProject(e, project.path)}
                          aria-label={`Close ${project.name}`}
                          title="Close project"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </div>

                  <div className={`sb-session-list ${expanded ? 'expanded' : ''}`}>
                    {project.tabs
                      .filter(tab => matchesSearchQuery(tab.label))
                      .map(tab => {
                        const isEditing = editingSessionId === tab.sessionId;

                        return (
                          <div
                            key={tab.sessionId}
                            className={`sb-session-item ${isSessionActive(project.path, tab.sessionId) ? 'active' : ''} ${isEditing ? 'editing' : ''}`}
                            onClick={() => !isEditing && handleSelectSession(project.path, tab.sessionId)}
                            onMouseEnter={() => !isEditing && setHoveredSession(tab.sessionId)}
                            onMouseLeave={() => setHoveredSession(null)}
                            title={isEditing ? undefined : tab.label}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                handleSelectSession(project.path, tab.sessionId);
                              }
                            }}
                          >
                            {isEditing ? (
                              <input
                                ref={renameInputRef}
                                type="text"
                                className="session-rename-input"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => handleSessionRenameKeyDown(e, project.path)}
                                onBlur={() => handleSessionRenameBlur(project.path)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Rename session"
                              />
                            ) : (
                              <span className="sb-session-label">
                                {tab.label}
                              </span>
                            )}
                            {(tab.isStreaming || tab.hasRunningAgent) && !isEditing && (
                              <span className="sb-session-dot" />
                            )}
                            {hoveredSession === tab.sessionId && !isEditing && (
                              <button
                                className="sb-session-close"
                                onClick={(e) => handleCloseSession(e, project.path, tab.sessionId)}
                                aria-label={`Close ${tab.label}`}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })
        )}
      </div>

      <div className="project-sidebar-footer">
        {showPicker && (
          <div className="project-picker" ref={pickerRef}>
            <input
              type="text"
              className="project-picker-input"
              placeholder="GitHub URL or filter projects..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              onKeyDown={handleFilterInputKeyDown}
              autoFocus
            />
            <div className="project-picker-list">
              {isLoading ? (
                <div className="project-picker-loading">Loading...</div>
              ) : isGitHubUrl(filterQuery) ? (
                <div className="project-picker-github-hint">
                  <div className="github-hint-icon">⎘</div>
                  <div className="github-hint-text">
                    <div className="github-hint-title">Clone repository</div>
                    <div className="github-hint-subtitle">Press Enter to clone from GitHub</div>
                  </div>
                </div>
              ) : filteredProjects.length === 0 ? (
                <>
                  <div className="project-picker-empty">No available projects</div>
                  <button
                    className="project-picker-browse-button"
                    onClick={() => {
                      setShowPicker(false);
                      setShowWorkspaceBrowser(true);
                    }}
                  >
                    Browse for workspace...
                  </button>
                </>
              ) : (
                <>
                  {filteredProjects.map(project => (
                    <div
                      key={project.path}
                      className="project-picker-item"
                      onClick={() => handleSelectProject(project.path, project.name)}
                      title={project.path}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectProject(project.path, project.name);
                        }
                      }}
                    >
                      <span className="project-picker-item-name">{project.name}</span>
                      <span className="project-picker-item-path">{project.path}</span>
                    </div>
                  ))}
                  <button
                    className="project-picker-browse-button"
                    onClick={() => {
                      setShowPicker(false);
                      setShowWorkspaceBrowser(true);
                    }}
                  >
                    Browse for workspace...
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {version && (
          <div className="sidebar-version">
            v{version}
          </div>
        )}

        <div className="sidebar-footer-nav">
          <button
            className={`footer-nav-item ${activePage === 'mcp' ? 'active' : ''}`}
            onClick={() => onNavigate('mcp')}
            aria-label="MCP Servers"
          >
            <span className="footer-nav-icon">⬡</span>
            <span className="footer-nav-label">MCP</span>
          </button>
          <button
            className={`footer-nav-item ${activePage === 'insights' ? 'active' : ''}`}
            onClick={() => onNavigate('insights')}
            aria-label="Insights"
          >
            <span className="footer-nav-icon">◈</span>
            <span className="footer-nav-label">Insights</span>
          </button>
          <button
            className={`footer-nav-item ${activePage === 'profile' ? 'active' : ''}`}
            onClick={() => onNavigate('profile')}
            aria-label="Profile"
          >
            <span className="footer-nav-icon">◇</span>
            <span className="footer-nav-label">Profile</span>
          </button>
          <button
            className="footer-nav-item"
            onClick={handleOpenPicker}
            aria-label="Open project"
          >
            <span className="footer-nav-icon">+</span>
            <span className="footer-nav-label">Open</span>
          </button>
        </div>
      </div>

      <div
        className="sidebar-resize-handle"
        onMouseDown={handleMouseDown}
        role="separator"
        aria-label="Resize sidebar"
      />
    </div>
  );
};

export default ProjectSidebar;
