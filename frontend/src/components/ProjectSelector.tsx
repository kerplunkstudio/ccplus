import React, { useState, useEffect, useRef } from 'react';
import './ProjectSelector.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';

interface Project {
  name: string;
  path: string;
}

interface ProjectSelectorProps {
  selectedProject: string | null;
  onSelectProject: (path: string) => void;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  selectedProject,
  onSelectProject,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch(`${SOCKET_URL}/api/projects`);
        if (res.ok) {
          const data = await res.json();
          setProjects(data.projects || []);
        }
      } catch {
        // silently fail
      }
    };
    fetchProjects();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedName = selectedProject
    ? projects.find((p) => p.path === selectedProject)?.name || selectedProject.split('/').pop()
    : null;

  const filtered = filter
    ? projects.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    : projects;

  return (
    <div className="project-selector" ref={dropdownRef}>
      <button
        className={`project-selector-trigger ${selectedProject ? 'has-project' : ''}`}
        onClick={() => setOpen(!open)}
        title={selectedProject || 'Select project'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="project-selector-label">
          {selectedName || 'No project'}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={`project-selector-arrow ${open ? 'open' : ''}`}
        >
          <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="project-selector-dropdown">
          <div className="project-selector-search">
            <input
              type="text"
              placeholder="Search projects..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
          </div>
          <div className="project-selector-list">
            {filtered.map((project) => (
              <button
                key={project.path}
                className={`project-selector-item ${selectedProject === project.path ? 'active' : ''}`}
                onClick={() => {
                  onSelectProject(project.path);
                  setOpen(false);
                  setFilter('');
                }}
              >
                <span className="project-item-name">{project.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="project-selector-empty">No projects found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
