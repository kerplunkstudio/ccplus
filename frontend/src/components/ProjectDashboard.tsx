import React, { useState, useEffect } from 'react';
import './ProjectDashboard.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || window.location.origin;

interface ProjectDashboardProps {
  projectPath: string;
  projectName: string;
  onNewSession: () => void;
  onLoadSession: (sessionId: string) => void;
}

interface GitInfo {
  branch: string;
  dirty_count: number;
}

interface RecentActivityItem {
  tool_name: string;
  timestamp: string;
  success: boolean;
  session_id: string;
}

interface SessionItem {
  session_id: string;
  last_user_message: string | null;
  last_activity: string;
  message_count: number;
}

interface ProjectStats {
  total_sessions: number;
  total_cost: number;
  total_duration_ms: number;
  total_tools: number;
  lines_of_code: number;
}

interface ProjectOverview {
  name: string;
  path: string;
  git: GitInfo | null;
  file_tree: string[];
  recent_activity: RecentActivityItem[];
  sessions: SessionItem[];
  stats: ProjectStats;
}

const formatTimeAgo = (timestamp: string): string => {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  projectPath,
  projectName,
  onNewSession,
  onLoadSession,
}) => {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverview = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${SOCKET_URL}/api/project/overview?project=${encodeURIComponent(projectPath)}`
        );
        if (response.ok) {
          const data = await response.json();
          setOverview(data);
        } else {
          const errorData = await response.json();
          setError(errorData.error || 'Failed to load project overview');
        }
      } catch (err) {
        setError('Failed to load project overview');
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
  }, [projectPath]);

  if (loading) {
    return (
      <div className="project-dashboard">
        <div className="dashboard-loading">Loading project overview...</div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="project-dashboard">
        <div className="dashboard-error">{error || 'Failed to load project overview'}</div>
      </div>
    );
  }

  const hasRecentSession = overview.sessions.length > 0;
  const mostRecentSession = hasRecentSession ? overview.sessions[0] : null;

  return (
    <div className="project-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h1 className="dashboard-project-name">{overview.name}</h1>
        {overview.git && (
          <div className="dashboard-git-status">
            <span
              className="dashboard-branch-indicator"
              data-clean={overview.git.dirty_count === 0}
            >
              ○
            </span>
            <span className="dashboard-branch-name">{overview.git.branch}</span>
            {overview.git.dirty_count > 0 && (
              <>
                <span className="dashboard-separator">·</span>
                <span className="dashboard-dirty-count">
                  {overview.git.dirty_count} dirty
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="dashboard-actions">
        <button className="dashboard-action-primary" onClick={onNewSession}>
          + New session
        </button>
        {mostRecentSession && (
          <button
            className="dashboard-action-secondary"
            onClick={() => onLoadSession(mostRecentSession.session_id)}
          >
            Resume: "{mostRecentSession.last_user_message?.substring(0, 40) || 'Untitled'}
            {(mostRecentSession.last_user_message?.length || 0) > 40 ? '...' : ''}"
          </button>
        )}
      </div>

      {/* Two-column layout */}
      <div className="dashboard-columns">
        {/* Left column: Session history */}
        <div className="dashboard-column-left">
          {overview.sessions.length > 0 ? (
            <>
              <div className="dashboard-section-label">SESSION HISTORY</div>
              <div className="dashboard-session-list">
                {overview.sessions.slice(0, 10).map((session) => (
                  <button
                    key={session.session_id}
                    className="dashboard-session-item"
                    onClick={() => onLoadSession(session.session_id)}
                  >
                    <div className="dashboard-session-header">
                      <span className="dashboard-session-label">
                        {session.last_user_message?.substring(0, 60) || 'Untitled session'}
                        {(session.last_user_message?.length || 0) > 60 ? '...' : ''}
                      </span>
                    </div>
                    <div className="dashboard-session-meta">
                      <span className="dashboard-session-time">
                        {formatTimeAgo(session.last_activity)}
                      </span>
                      <span className="dashboard-separator">·</span>
                      <span className="dashboard-session-count">
                        {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="dashboard-empty-state">
              <p>No sessions yet</p>
              <p className="dashboard-empty-hint">Start a new session to begin coding</p>
            </div>
          )}
        </div>

        {/* Right column: Files + Activity + Stats */}
        <div className="dashboard-column-right">
          {/* File tree */}
          {overview.file_tree.length > 0 && (
            <div className="dashboard-section">
              <div className="dashboard-section-label">FILES</div>
              <div className="dashboard-file-tree">
                {overview.file_tree.map((entry, idx) => (
                  <div
                    key={idx}
                    className={`dashboard-file-entry ${
                      entry.endsWith('/') ? 'directory' : 'file'
                    }`}
                  >
                    {entry}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {overview.recent_activity.length > 0 && (
            <div className="dashboard-section">
              <div className="dashboard-section-label">RECENT ACTIVITY</div>
              <div className="dashboard-activity-list">
                {overview.recent_activity.slice(0, 10).map((event, idx) => (
                  <div key={idx} className="dashboard-activity-item">
                    <span
                      className="dashboard-activity-status"
                      data-success={event.success}
                    />
                    <span className="dashboard-activity-tool">{event.tool_name}</span>
                    <span className="dashboard-activity-time">
                      {formatTimeAgo(event.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="dashboard-section">
            <div className="dashboard-section-label">STATS</div>
            <div className="dashboard-stats">
              <div className="dashboard-stat-row">
                <span className="dashboard-stat-label">Sessions</span>
                <span className="dashboard-stat-value">
                  {overview.stats.total_sessions}
                </span>
              </div>
              <div className="dashboard-stat-row">
                <span className="dashboard-stat-label">Tools</span>
                <span className="dashboard-stat-value">{overview.stats.total_tools}</span>
              </div>
              <div className="dashboard-stat-row">
                <span className="dashboard-stat-label">Lines of code</span>
                <span className="dashboard-stat-value">
                  {formatNumber(overview.stats.lines_of_code)}
                </span>
              </div>
              <div className="dashboard-stat-row">
                <span className="dashboard-stat-label">Total time</span>
                <span className="dashboard-stat-value">
                  {formatDuration(overview.stats.total_duration_ms)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
