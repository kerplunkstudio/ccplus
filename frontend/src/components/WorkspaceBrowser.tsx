import React, { useState, useEffect, useCallback } from 'react';
import './WorkspaceBrowser.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_git: boolean;
}

interface BrowseResponse {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
}

interface DetectedProject {
  name: string;
  path: string;
}

interface WorkspaceBrowserProps {
  onSelectWorkspace: (path: string) => void;
  onClose: () => void;
}

export function WorkspaceBrowser({ onSelectWorkspace, onClose }: WorkspaceBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [detectedProjects, setDetectedProjects] = useState<DetectedProject[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDirectory = useCallback(async (path?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const url = path
        ? `${SOCKET_URL}/api/browse?path=${encodeURIComponent(path)}`
        : `${SOCKET_URL}/api/browse`;

      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to browse directory');
      }

      const data: BrowseResponse = await response.json();
      setCurrentPath(data.path);
      setParentPath(data.parent);
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchDetectedProjects = useCallback(async () => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/scan-projects`);

      if (response.ok) {
        const data = await response.json();
        setDetectedProjects(data.projects || []);
      }
    } catch (err) {
      // Silently fail, detected projects are optional
    }
  }, []);

  useEffect(() => {
    fetchDirectory();
    fetchDetectedProjects();
  }, [fetchDirectory, fetchDetectedProjects]);

  const handleNavigate = (path: string) => {
    fetchDirectory(path);
  };

  const handleGoUp = () => {
    if (parentPath) {
      fetchDirectory(parentPath);
    }
  };

  const handleSelectCurrent = () => {
    onSelectWorkspace(currentPath);
  };

  const handleSelectDetected = (path: string) => {
    onSelectWorkspace(path);
  };

  const getBreadcrumbs = (): string[] => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    return parts;
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="workspace-browser-overlay" onClick={onClose}>
      <div className="workspace-browser" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-browser-header">
          <h2 className="workspace-browser-title">Browse Workspace</h2>
          <button
            className="workspace-browser-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {detectedProjects.length > 0 && (
          <div className="detected-projects-section">
            <h3 className="detected-projects-heading">Detected Projects</h3>
            <div className="detected-projects-list">
              {detectedProjects.map((project) => (
                <button
                  key={project.path}
                  className="detected-project-item"
                  onClick={() => handleSelectDetected(project.path)}
                  title={project.path}
                >
                  <span className="detected-project-icon">📁</span>
                  <span className="detected-project-name">{project.name}</span>
                  <span className="detected-project-path">{project.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="workspace-browser-body">
          <div className="workspace-browser-navigation">
            <div className="breadcrumb-container">
              <button
                className="breadcrumb-up"
                onClick={handleGoUp}
                disabled={!parentPath}
                aria-label="Go up"
              >
                ↑
              </button>
              <div className="breadcrumb-path">
                {breadcrumbs.length > 0 ? (
                  breadcrumbs.map((part, index) => (
                    <span key={index} className="breadcrumb-part">
                      /{part}
                    </span>
                  ))
                ) : (
                  <span className="breadcrumb-part">/</span>
                )}
              </div>
            </div>
            <button
              className="workspace-select-button"
              onClick={handleSelectCurrent}
              disabled={!currentPath}
            >
              Select as workspace
            </button>
          </div>

          {error && (
            <div className="workspace-browser-error">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="workspace-browser-loading">
              <div className="spinner" />
              <span>Loading...</span>
            </div>
          ) : (
            <div className="workspace-browser-list">
              {entries.length === 0 ? (
                <div className="workspace-browser-empty">
                  No directories found
                </div>
              ) : (
                entries.map((entry) => (
                  <div
                    key={entry.path}
                    className="workspace-directory-item"
                    onClick={() => handleNavigate(entry.path)}
                    title={entry.path}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleNavigate(entry.path);
                      }
                    }}
                  >
                    <span className={`directory-icon ${entry.is_git ? 'git' : ''}`}>
                      {entry.is_git ? '📦' : '📁'}
                    </span>
                    <span className="directory-name">{entry.name}</span>
                    {entry.is_git && (
                      <span className="git-badge">git</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
