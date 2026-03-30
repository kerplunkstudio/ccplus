import React from 'react';
import './SessionProposalCard.css';

interface SessionProposalCardProps {
  sessionId: string;
  prompt: string;
  workspace: string;
  workflow: string;
}

export function SessionProposalCard({
  sessionId,
  prompt,
  workspace,
  workflow,
}: SessionProposalCardProps) {
  const workspaceName = workspace.split('/').pop() || workspace;

  return (
    <div className="session-proposal-card">
      <div className="session-proposal-header">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="session-proposal-icon"
        >
          <path
            d="M8 2v12M2 8h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span className="session-proposal-title">Session Started</span>
      </div>

      <div className="session-proposal-body">
        <div className="session-proposal-field">
          <span className="session-proposal-label">Session ID</span>
          <code className="session-proposal-value">{sessionId}</code>
        </div>

        <div className="session-proposal-field">
          <span className="session-proposal-label">Workspace</span>
          <span className="session-proposal-value">{workspaceName}</span>
        </div>

        <div className="session-proposal-field">
          <span className="session-proposal-label">Workflow</span>
          <span className="session-proposal-value session-proposal-workflow">{workflow}</span>
        </div>

        <div className="session-proposal-field">
          <span className="session-proposal-label">Task</span>
          <p className="session-proposal-prompt">{prompt}</p>
        </div>
      </div>
    </div>
  );
}
