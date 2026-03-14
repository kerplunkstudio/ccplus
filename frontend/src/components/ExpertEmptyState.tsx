import React, { useState, useEffect } from 'react';
import './ExpertEmptyState.css';

interface ProjectStats {
  totalSessions: number;
  lastProject: string | null;
  favoriteCommands: string[];
  recentWorkspaces: string[];
}

interface ExpertEmptyStateProps {
  onSendMessage: (content: string) => void;
  projectPath?: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

// Power user command templates
const POWER_COMMANDS = [
  {
    category: 'AGENTS',
    commands: [
      '/code-reviewer',
      '/security-reviewer',
      '/architect',
      '/tdd',
      '/build-fix'
    ]
  },
  {
    category: 'WORKFLOWS',
    commands: [
      'Implement auth module with TDD',
      'Refactor the API layer for better separation',
      'Set up CI/CD pipeline with automated testing',
      'Add comprehensive logging and monitoring'
    ]
  },
  {
    category: 'DIRECT',
    commands: [
      'Read all TypeScript config files',
      'Show me the database schema',
      'Analyze the current test coverage',
      'Review recent git commits'
    ]
  }
];

export const ExpertEmptyState: React.FC<ExpertEmptyStateProps> = ({
  onSendMessage,
  projectPath,
  textareaRef
}) => {
  const [stats, setStats] = useState<ProjectStats>({
    totalSessions: 0,
    lastProject: null,
    favoriteCommands: [],
    recentWorkspaces: []
  });
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every second for terminal vibe
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Load user stats from localStorage and API
  useEffect(() => {
    // Get stats from localStorage
    const sessions = localStorage.getItem('ccplus_session_count') || '0';
    const commands = JSON.parse(localStorage.getItem('ccplus_favorite_commands') || '[]');
    const workspaces = JSON.parse(localStorage.getItem('ccplus_recent_workspaces') || '[]');

    setStats({
      totalSessions: parseInt(sessions),
      lastProject: projectPath || null,
      favoriteCommands: commands.slice(0, 3),
      recentWorkspaces: workspaces.slice(0, 3)
    });
  }, [projectPath]);

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
      {/* Terminal-style header */}
      <div className="expert-header">
        <div className="expert-status-bar">
          <span className="expert-time">{formatTime(currentTime)}</span>
          <span className="expert-sessions">#{stats.totalSessions + 1}</span>
          <span className="expert-project">
            {projectPath ? projectPath.split('/').pop() : 'NO_PROJECT'}
          </span>
        </div>
      </div>

      {/* System metrics grid */}
      <div className="expert-metrics">
        <div className="metric-block">
          <div className="metric-value">{stats.totalSessions}</div>
          <div className="metric-label">TOTAL_SESSIONS</div>
        </div>
        <div className="metric-block">
          <div className="metric-value">{stats.recentWorkspaces.length}</div>
          <div className="metric-label">WORKSPACES</div>
        </div>
        <div className="metric-block">
          <div className="metric-value">{stats.favoriteCommands.length}</div>
          <div className="metric-label">SAVED_CMDS</div>
        </div>
      </div>

      {/* Command categories in brutal grid */}
      <div className="expert-commands">
        {POWER_COMMANDS.map((category, categoryIdx) => (
          <div key={category.category} className="command-category">
            <div className="category-header">
              <span className="category-index">[{categoryIdx + 1}]</span>
              <span className="category-name">{category.category}</span>
            </div>
            <div className="category-commands">
              {category.commands.map((command, cmdIdx) => (
                <button
                  key={command}
                  className="expert-command-btn"
                  onClick={() => handleCommandClick(command)}
                  data-index={cmdIdx + 1}
                >
                  <span className="cmd-index">{cmdIdx + 1}</span>
                  <span className="cmd-text">{command}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recent workspaces if any */}
      {stats.recentWorkspaces.length > 0 && (
        <div className="expert-recent">
          <div className="recent-header">RECENT_WORKSPACES:</div>
          <div className="recent-list">
            {stats.recentWorkspaces.map((workspace, idx) => (
              <button
                key={workspace}
                className="recent-workspace-btn"
                onClick={() => handleCommandClick(`Switch to workspace: ${workspace}`)}
              >
                <span className="ws-index">{idx + 1}</span>
                <span className="ws-path">{workspace}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Terminal-style footer */}
      <div className="expert-footer">
        <div className="footer-prompt">
          <span className="prompt-symbol">$</span>
          <span className="prompt-text">type command or [1-9] for shortcuts</span>
        </div>
      </div>
    </div>
  );
};