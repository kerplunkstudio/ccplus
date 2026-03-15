import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectEntry } from '../types';
import { WorkspaceBrowser } from './WorkspaceBrowser';
import './ProjectSidebar.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface AvailableProject {
  name: string;
  path: string;
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

  const pickerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number>(0);

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
        alert(`Failed to clone repository: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Failed to clone repository: ${error}`);
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
        alert(`Failed to set workspace: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Failed to set workspace: ${error}`);
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
    onSelectProject(projectPath);
    onSelectTab(projectPath, sessionId);
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
        {projects.length === 0 ? (
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
                    {project.tabs.length === 0 ? (
                      <div className="sb-session-empty">
                        <span className="sb-session-empty-text">No active sessions</span>
                        <button
                          className="sb-session-empty-action"
                          onClick={(e) => handleNewTab(e, project.path)}
                        >
                          + New session
                        </button>
                      </div>
                    ) : (
                      project.tabs
                        .filter(tab => matchesSearchQuery(tab.label))
                        .map(tab => (
                          <div
                            key={tab.sessionId}
                            className={`sb-session-item ${isSessionActive(project.path, tab.sessionId) ? 'active' : ''}`}
                            onClick={() => handleSelectSession(project.path, tab.sessionId)}
                            onMouseEnter={() => setHoveredSession(tab.sessionId)}
                            onMouseLeave={() => setHoveredSession(null)}
                            title={tab.label}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSelectSession(project.path, tab.sessionId);
                              }
                            }}
                          >
                            <span className="sb-session-label">
                              {tab.label}
                            </span>
                            {(tab.isStreaming || tab.hasRunningAgent) && (
                              <span className="sb-session-dot" />
                            )}
                            {hoveredSession === tab.sessionId && (
                              <button
                                className="sb-session-close"
                                onClick={(e) => handleCloseSession(e, project.path, tab.sessionId)}
                                aria-label={`Close ${tab.label}`}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))
                    )}
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
