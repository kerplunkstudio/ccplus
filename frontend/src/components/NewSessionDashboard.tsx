import React, { useState, useEffect } from 'react';
import { UsageStats } from '../types';
import './NewSessionDashboard.css';

interface GitContext {
  branch: string;
  dirty_count: number;
  commits: Array<{ hash: string; message: string; time_ago: string }>;
}

interface NewSessionDashboardProps {
  projectPath: string | null;
  usageStats: UsageStats;
  pastSessions: Array<{
    session_id: string;
    last_user_message: string | null;
    last_activity: string;
  }>;
  onLoadSession: (sessionId: string) => void;
}

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

export const NewSessionDashboard: React.FC<NewSessionDashboardProps> = ({
  projectPath,
  usageStats,
  pastSessions,
  onLoadSession,
}) => {
  const [gitContext, setGitContext] = useState<GitContext | null>(null);
  const [showSessions, setShowSessions] = useState(false);

  // Fetch git context on mount / when projectPath changes
  useEffect(() => {
    if (!projectPath) return;
    const SOCKET_URL =
      process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
    fetch(
      `${SOCKET_URL}/api/git/context?project=${encodeURIComponent(projectPath)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !data.error) setGitContext(data);
      })
      .catch(() => {});
  }, [projectPath]);

  const projectName = projectPath ? projectPath.split('/').pop() : null;

  return (
    <div className="new-session-dashboard">
      {/* Project header */}
      <div className="project-header">
        {projectName && <div className="project-name">{projectName}</div>}
        {gitContext && (
          <div className="git-status">
            <span
              className="branch-indicator"
              data-clean={gitContext.dirty_count === 0}
            >
              ○
            </span>
            <span className="branch-name">{gitContext.branch}</span>
            {gitContext.dirty_count > 0 && (
              <>
                <span className="separator">·</span>
                <span className="dirty-count">{gitContext.dirty_count} dirty</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Recent commits section */}
      {gitContext && gitContext.commits && gitContext.commits.length > 0 && (
        <div className="recent-commits">
          <div className="section-label">RECENT COMMITS</div>
          <div className="commits-list">
            {gitContext.commits.slice(0, 5).map((commit) => (
              <div key={commit.hash} className="commit-row">
                <span className="commit-hash">{commit.hash}</span>
                <span className="commit-message">
                  {commit.message.length > 45
                    ? commit.message.substring(0, 45) + '...'
                    : commit.message}
                </span>
                <span className="commit-time">{commit.time_ago}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="divider" />

      {/* Stats row */}
      <div className="stats-row">
        <span className="stat-item">
          <span className="stat-value">{usageStats.totalSessions}</span> sessions
        </span>
        <span className="separator">·</span>
        <span className="stat-item">
          <span className="stat-value">{formatNumber(usageStats.linesOfCode)}</span> lines
        </span>
        <span className="separator">·</span>
        <span className="stat-item">
          <span className="stat-value">{formatDuration(usageStats.totalDuration)}</span> total
        </span>
      </div>

      {/* Recent sessions (collapsible) */}
      {pastSessions.length > 0 && (
        <div className="recent-sessions">
          <button
            className="sessions-toggle"
            onClick={() => setShowSessions(!showSessions)}
          >
            <span className="toggle-icon">{showSessions ? '▾' : '▸'}</span>
            {pastSessions.length} recent session{pastSessions.length !== 1 ? 's' : ''}
          </button>
          {showSessions && (
            <div className="sessions-list">
              {pastSessions.slice(0, 5).map((session) => (
                <button
                  key={session.session_id}
                  className="session-item"
                  onClick={() => onLoadSession(session.session_id)}
                >
                  <span className="session-label">
                    {session.last_user_message
                      ? session.last_user_message.length > 50
                        ? session.last_user_message.substring(0, 50) + '...'
                        : session.last_user_message
                      : 'Untitled session'}
                  </span>
                  <span className="session-time">
                    {(() => {
                      const diffMs = Date.now() - new Date(session.last_activity).getTime();
                      const diffMins = Math.floor(diffMs / 60000);
                      if (diffMins < 1) return 'just now';
                      if (diffMins < 60) return `${diffMins}m ago`;
                      const diffHours = Math.floor(diffMins / 60);
                      if (diffHours < 24) return `${diffHours}h ago`;
                      const diffDays = Math.floor(diffHours / 24);
                      return `${diffDays}d ago`;
                    })()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
