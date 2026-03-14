import React, { useState, useEffect, useRef } from 'react';
import { ProjectEntry } from '../types';
import './ProjectSidebar.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface AvailableProject {
  name: string;
  path: string;
}

interface ProjectSidebarProps {
  projects: ProjectEntry[];
  activeProjectPath: string | null;
  onSelectProject: (path: string) => void;
  onAddProject: (path: string, name: string) => void;
  onRemoveProject: (path: string) => void;
}

const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  activeProjectPath,
  onSelectProject,
  onAddProject,
  onRemoveProject,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<AvailableProject[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  const handleSelectProject = (path: string, name: string) => {
    onAddProject(path, name);
    setShowPicker(false);
    setFilterQuery('');
  };

  const handleRemoveProject = (event: React.MouseEvent, path: string) => {
    event.stopPropagation();
    onRemoveProject(path);
  };

  const isProjectActive = (projectPath: string): boolean => {
    return projectPath === activeProjectPath;
  };

  const hasRunningActivity = (project: ProjectEntry): boolean => {
    return project.tabs.some(tab => tab.isStreaming || tab.hasRunningAgent);
  };

  const filteredProjects = availableProjects.filter(project => {
    const isAlreadyOpen = projects.some(p => p.path === project.path);
    const matchesFilter = project.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
                         project.path.toLowerCase().includes(filterQuery.toLowerCase());
    return !isAlreadyOpen && matchesFilter;
  });

  return (
    <div className="project-sidebar">
      <div className="project-sidebar-header">
        <h1 className="sidebar-brand-title">CC+</h1>
        <p className="sidebar-brand-subtitle">OBS</p>
      </div>

      <div className="project-list">
        {projects.length === 0 ? (
          <div className="project-empty-state">
            <p className="project-empty-message">Open a project to start</p>
          </div>
        ) : (
          projects.map(project => (
            <div
              key={project.path}
              className={`project-item ${isProjectActive(project.path) ? 'active' : ''}`}
              onClick={() => onSelectProject(project.path)}
            >
              <span className="project-item-name" title={project.path}>
                {project.name}
              </span>
              {hasRunningActivity(project) && (
                <span className="project-item-dot" />
              )}
              <button
                className="project-item-close"
                onClick={(e) => handleRemoveProject(e, project.path)}
                aria-label={`Remove ${project.name}`}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="project-sidebar-footer">
        <button
          className="project-add-btn"
          onClick={handleOpenPicker}
        >
          + Open project
        </button>

        {showPicker && (
          <div className="project-picker" ref={pickerRef}>
            <input
              type="text"
              className="project-picker-input"
              placeholder="Filter projects..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              autoFocus
            />
            <div className="project-picker-list">
              {isLoading ? (
                <div className="project-picker-loading">Loading...</div>
              ) : filteredProjects.length === 0 ? (
                <div className="project-picker-empty">No available projects</div>
              ) : (
                filteredProjects.map(project => (
                  <div
                    key={project.path}
                    className="project-picker-item"
                    onClick={() => handleSelectProject(project.path, project.name)}
                    title={project.path}
                  >
                    <span className="project-picker-item-name">{project.name}</span>
                    <span className="project-picker-item-path">{project.path}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectSidebar;
