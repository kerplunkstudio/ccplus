import React, { useState, useEffect } from 'react';
import { UsageStats } from '../types';
import './ExpertEmptyState.css';


interface ExpertEmptyStateProps {
  onSendMessage: (content: string) => void;
  projectPath?: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  usageStats: UsageStats;
}

// Refined command suggestions for experienced users
const COMMAND_SUGGESTIONS = [
  {
    label: 'Review & Analysis',
    commands: [
      '/code-reviewer',
      '/security-reviewer',
      '/architect'
    ]
  },
  {
    label: 'Development',
    commands: [
      '/tdd',
      '/build-fix',
      'Implement auth with TDD'
    ]
  }
];

export const ExpertEmptyState: React.FC<ExpertEmptyStateProps> = ({
  onSendMessage,
  projectPath,
  textareaRef,
  usageStats
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every second for terminal vibe
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);


  const handleCommandClick = (command: string) => {
    onSendMessage(command);
    textareaRef.current?.focus();
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="expert-empty-state">
      {/* Simple session info */}
      <div className="session-header">
        <div className="session-stats">
          <div className="stat-item">
            <span className="stat-value">{usageStats.totalSessions}</span>
            <span className="stat-label">Total sessions</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{formatTime(currentTime)}</span>
            <span className="stat-label">Current time</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{usageStats.linesOfCode.toLocaleString()}</span>
            <span className="stat-label">Lines of code</span>
          </div>
        </div>
        {projectPath && (
          <div className="project-name">
            {projectPath.split('/').pop()}
          </div>
        )}
      </div>

      {/* Clean command suggestions */}
      <div className="command-suggestions">
        <div className="suggestions-header">
          <h3>Quick actions</h3>
          <p>Common commands for experienced users</p>
        </div>

        {COMMAND_SUGGESTIONS.map((category) => (
          <div key={category.label} className="suggestion-group">
            <h4 className="group-label">{category.label}</h4>
            <div className="commands-grid">
              {category.commands.map((command) => (
                <button
                  key={command}
                  className="command-button"
                  onClick={() => handleCommandClick(command)}
                >
                  {command}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};