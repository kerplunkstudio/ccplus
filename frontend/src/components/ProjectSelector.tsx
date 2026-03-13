import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ProjectSelector.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

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
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const filtered = filter
    ? projects.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    : projects;

  // "All projects" is index 0, then filtered projects follow
  const totalItems = filtered.length + 1;

  useEffect(() => {
    if (open && focusedIndex >= 0 && focusedIndex < totalItems && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [open, focusedIndex, totalItems]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setFilter('');
    setFocusedIndex(-1);
  }, []);

  const handleSelect = useCallback((path: string) => {
    onSelectProject(path);
    handleClose();
  }, [onSelectProject, handleClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
        setFocusedIndex(-1);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        handleClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, totalItems - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (focusedIndex <= 0) {
          setFocusedIndex(-1);
          searchRef.current?.focus();
        } else {
          setFocusedIndex((prev) => prev - 1);
        }
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(totalItems - 1);
        break;
      case 'Enter':
        if (focusedIndex === 0) {
          e.preventDefault();
          handleSelect('');
        } else if (focusedIndex > 0 && focusedIndex <= filtered.length) {
          e.preventDefault();
          handleSelect(filtered[focusedIndex - 1].path);
        }
        break;
      case 'Tab':
        handleClose();
        break;
    }
  };

  const selectedName = selectedProject
    ? projects.find((p) => p.path === selectedProject)?.name || selectedProject.split('/').pop()
    : null;

  const listboxId = 'project-selector-listbox';

  return (
    <div className="project-selector" ref={dropdownRef} onKeyDown={handleKeyDown}>
      <button
        className={`project-selector-trigger ${selectedProject ? 'has-project' : ''}`}
        onClick={() => (open ? handleClose() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={`Project: ${selectedName || 'No project'}`}
        title={selectedProject || 'Select project'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
          aria-hidden="true"
        >
          <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="project-selector-dropdown">
          <div className="project-selector-search">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search projects..."
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setFocusedIndex(-1);
              }}
              autoFocus
              aria-label="Filter projects"
              role="combobox"
              aria-expanded={true}
              aria-controls={listboxId}
              aria-activedescendant={focusedIndex >= 0 ? `project-option-${focusedIndex}` : undefined}
            />
          </div>
          <div className="project-selector-list" role="listbox" id={listboxId} aria-label="Projects">
            <button
              ref={(el) => { itemRefs.current[0] = el; }}
              id="project-option-0"
              className={`project-selector-item ${selectedProject === null ? 'active' : ''} ${focusedIndex === 0 ? 'focused' : ''}`}
              role="option"
              aria-selected={selectedProject === null}
              onClick={() => handleSelect('')}
              tabIndex={-1}
            >
              <span className="project-item-name">All projects</span>
            </button>
            {filtered.map((project, index) => (
              <button
                key={project.path}
                ref={(el) => { itemRefs.current[index + 1] = el; }}
                id={`project-option-${index + 1}`}
                className={`project-selector-item ${selectedProject === project.path ? 'active' : ''} ${focusedIndex === index + 1 ? 'focused' : ''}`}
                role="option"
                aria-selected={selectedProject === project.path}
                onClick={() => handleSelect(project.path)}
                tabIndex={-1}
              >
                <span className="project-item-name">{project.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="project-selector-empty" role="status">No projects found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
