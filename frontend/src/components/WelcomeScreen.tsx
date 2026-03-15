import React, { useState, useEffect } from 'react';
import { WorkspaceBrowser } from './WorkspaceBrowser';
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
        alert(`Failed to set workspace: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Failed to set workspace: ${error}`);
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

      <div className="welcome-hero">
        <div className="welcome-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 2L2 7L12 12L22 7L12 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 17L12 22L22 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 12L12 17L22 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="welcome-title">Welcome to cc+</h1>
        <p className="welcome-subtitle">
          A web UI and observability layer for Claude Code
        </p>
      </div>

      <div className="welcome-section">
        <h2 className="section-heading">What you can do</h2>
        <ul className="feature-list">
          <li className="feature-item">
            <span className="feature-icon">🌳</span>
            <div>
              <strong>Real-time activity tree</strong>
              <span className="feature-description">
                Watch every agent spawn and tool call as it happens
              </span>
            </div>
          </li>
          <li className="feature-item">
            <span className="feature-icon">📊</span>
            <div>
              <strong>Tool usage tracking</strong>
              <span className="feature-description">
                Monitor API calls, tokens, and costs across sessions
              </span>
            </div>
          </li>
          <li className="feature-item">
            <span className="feature-icon">📁</span>
            <div>
              <strong>Multi-project workspaces</strong>
              <span className="feature-description">
                Organize conversations by project with tabbed sessions
              </span>
            </div>
          </li>
        </ul>
      </div>

      <div className="welcome-section">
        <h2 className="section-heading">Try an example</h2>
        <div className="prompt-grid">
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example.title}
              className="prompt-card"
              onClick={() => onSelectPrompt(example.prompt)}
            >
              <h3 className="prompt-title">{example.title}</h3>
              <p className="prompt-description">{example.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Workspace setup section */}
      <div className="welcome-section">
        <h2 className="section-heading">Set up workspace</h2>

        {isLoadingProjects ? (
          <div className="workspace-loading">
            <div className="spinner" />
            <span>Scanning for projects...</span>
          </div>
        ) : detectedProjects.length > 0 ? (
          <div className="workspace-detected">
            <p className="workspace-detected-description">
              We found {detectedProjects.length} project{detectedProjects.length === 1 ? '' : 's'} on your system:
            </p>
            <div className="workspace-detected-list">
              {detectedProjects.slice(0, 5).map((project) => (
                <button
                  key={project.path}
                  className="workspace-detected-item"
                  onClick={() => handleSelectDetectedProject(project.path)}
                  title={project.path}
                >
                  <span className="workspace-detected-icon">📦</span>
                  <div className="workspace-detected-content">
                    <span className="workspace-detected-name">{project.name}</span>
                    <span className="workspace-detected-path">{project.path}</span>
                  </div>
                </button>
              ))}
            </div>
            {detectedProjects.length > 5 && (
              <p className="workspace-detected-more">
                + {detectedProjects.length - 5} more project{detectedProjects.length - 5 === 1 ? '' : 's'}
              </p>
            )}
          </div>
        ) : (
          <p className="workspace-empty-message">
            No projects detected. Browse to select a workspace directory.
          </p>
        )}

        <button className="workspace-browse-button" onClick={() => setShowBrowser(true)}>
          Browse for workspace...
        </button>
      </div>

      <div className="welcome-cta">
        <p className="cta-hint">
          Select a workspace or add a project to start using Claude Code
        </p>
      </div>
    </div>
  );
}
