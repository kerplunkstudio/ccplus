import React from 'react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  onSelectPrompt: (prompt: string) => void;
  onAddProject: () => void;
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
  return (
    <div className="welcome-screen">
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

      <div className="welcome-cta">
        <button className="cta-button" onClick={onAddProject}>
          <span className="cta-icon">+</span>
          Add a project
        </button>
        <p className="cta-hint">
          Add a project folder to start using Claude Code
        </p>
      </div>
    </div>
  );
}
