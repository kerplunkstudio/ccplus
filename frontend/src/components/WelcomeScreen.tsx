import React, { useState, useEffect } from 'react';
import { WorkspaceBrowser } from './WorkspaceBrowser';
import { useToast } from '../contexts/ToastContext';
import './WelcomeScreen.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface DetectedProject {
  name: string;
  path: string;
}

interface WelcomeScreenProps {
  onSelectPrompt: (prompt: string) => void;
  onAddProject: (path: string, name: string) => void;
}

const EXAMPLE_PROMPTS = [
  {
    title: 'Build a feature',
    description: 'Implement a new API endpoint with tests',
    prompt: 'Create a new REST API endpoint for user authentication with JWT tokens. Include unit tests and error handling.',
  },
  {
    title: 'Fix a bug',
    description: 'Debug and resolve an issue',
    prompt: 'There\'s a race condition in the session manager causing duplicate queries. Help me find and fix it.',
  },
  {
    title: 'Refactor code',
    description: 'Improve code quality',
    prompt: 'Refactor the database.py module to reduce complexity and improve maintainability. Split large functions into smaller ones.',
  },
  {
    title: 'Write documentation',
    description: 'Document your codebase',
    prompt: 'Review the API endpoints and generate OpenAPI/Swagger documentation. Include request/response examples.',
  },
];

export function WelcomeScreen({ onSelectPrompt, onAddProject }: WelcomeScreenProps) {
  const [showBrowser, setShowBrowser] = useState(false);
  const [detectedProjects, setDetectedProjects] = useState<DetectedProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const fetchDetectedProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const response = await fetch(`${SOCKET_URL}/api/scan-projects`);
        if (response.ok) {
          const data = await response.json();
          setDetectedProjects(data.projects || []);
        }
      } catch (err) {
        // Silently fail, detected projects are optional
      } finally {
        setIsLoadingProjects(false);
      }
    };

    fetchDetectedProjects();
  }, []);

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
        setShowBrowser(false);
      } else {
        const errorData = await response.json();
        showToast(`Failed to set workspace: ${errorData.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      showToast(`Failed to set workspace: ${error}`, 'error');
    }
  };

  const handleSelectDetectedProject = (path: string) => {
    const name = path.split('/').pop() || 'Project';
    onAddProject(path, name);
  };

  return (
    <div className="welcome-screen">
      {showBrowser && (
        <WorkspaceBrowser
          onSelectWorkspace={handleSelectWorkspace}
          onClose={() => setShowBrowser(false)}
        />
      )}

      <header className="welcome-header">
        <h1 className="welcome-title">cc+</h1>
        <p className="welcome-subtitle">Watch your agents work.</p>
      </header>

      <section className="welcome-section">
        <h2 className="sr-only">Features</h2>
        <ul className="feature-list">
          <li className="feature-item">
            <strong>Real-time activity tree</strong>
            <span className="feature-description">
              Watch every agent spawn and tool call as it happens
            </span>
          </li>
          <li className="feature-item">
            <strong>Tool usage tracking</strong>
            <span className="feature-description">
              Monitor API calls, tokens, and costs across sessions
            </span>
          </li>
          <li className="feature-item">
            <strong>Multi-project workspaces</strong>
            <span className="feature-description">
              Organize conversations by project with tabbed sessions
            </span>
          </li>
        </ul>
      </section>

      <section className="welcome-section">
        <h2 className="section-label">Example prompts</h2>
        <ul className="prompt-list">
          {EXAMPLE_PROMPTS.map((example) => (
            <li key={example.title}>
              <button
                className="prompt-link"
                onClick={() => onSelectPrompt(example.prompt)}
              >
                <span className="prompt-title">{example.title}</span>
                <span className="prompt-description">{example.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="welcome-section workspace-section">
        {isLoadingProjects ? (
          <div className="workspace-loading">
            <div className="spinner" />
            <span>Scanning for projects...</span>
          </div>
        ) : detectedProjects.length > 0 ? (
          <>
            <h2 className="section-label">
              {detectedProjects.length} detected project{detectedProjects.length === 1 ? '' : 's'}
            </h2>
            <ul className="workspace-list">
              {detectedProjects.slice(0, 5).map((project) => (
                <li key={project.path}>
                  <button
                    className="workspace-item"
                    onClick={() => handleSelectDetectedProject(project.path)}
                    title={project.path}
                  >
                    <span className="workspace-name">{project.name}</span>
                    <span className="workspace-path">{project.path}</span>
                  </button>
                </li>
              ))}
            </ul>
            {detectedProjects.length > 5 && (
              <p className="workspace-more">
                +{detectedProjects.length - 5} more
              </p>
            )}
          </>
        ) : (
          <p className="workspace-empty">
            No projects detected.
          </p>
        )}

        <button className="workspace-browse" onClick={() => setShowBrowser(true)}>
          Browse for workspace
        </button>
      </section>
    </div>
  );
}
