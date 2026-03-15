import React, { useState, useEffect } from 'react';
import './ProjectDashboard.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178C6',
  JavaScript: '#F7DF1E',
  Python: '#3572A5',
  CSS: '#563D7C',
  SCSS: '#C6538C',
  HTML: '#E34C26',
  Rust: '#DEA584',
  Go: '#00ADD8',
  Java: '#B07219',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  C: '#555555',
  'C++': '#F34B7D',
  Shell: '#89E051',
  SQL: '#E38C00',
  JSON: '#A0A0A0',
  YAML: '#CB171E',
  Markdown: '#083FA1',
  Vue: '#42B883',
  XML: '#FF6600',
  TOML: '#9C4121',
  INI: '#6E4C13',
};
const DEFAULT_LANG_COLOR = '#8B8B8B';

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

interface LanguageInfo {
  name: string;
  files: number;
  percentage: number;
}

interface ClaudeMdInfo {
  exists: boolean;
  excerpt: string | null;
}

interface ProjectOverview {
  name: string;
  path: string;
  git: GitInfo | null;
  file_tree: string[];
  file_count: number;
  commit_count: number;
  tech_stack: string[];
  languages: LanguageInfo[];
  claude_md: ClaudeMdInfo;
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
        const url = `${SOCKET_URL}/api/project/overview?project=${encodeURIComponent(projectPath)}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setOverview(data);
        } else {
          const text = await response.text();
          try {
            const errorData = JSON.parse(text);
            setError(errorData.error || `HTTP ${response.status}`);
          } catch {
            setError(`HTTP ${response.status}: ${text.substring(0, 100)}`);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Network error: ${message}`);
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
        {/* Left column: Project info + Tech stack + Languages + CLAUDE.md */}
        <div className="dashboard-column-left">
          {/* Project info cards */}
          <div className="dashboard-section">
            <div className="dashboard-section-label">PROJECT INFO</div>
            <div className="dashboard-info-grid">
              <div className="dashboard-info-card">
                <div className="dashboard-info-value">{formatNumber(overview.file_count)}</div>
                <div className="dashboard-info-label">Files</div>
              </div>
              <div className="dashboard-info-card">
                <div className="dashboard-info-value">{formatNumber(overview.commit_count)}</div>
                <div className="dashboard-info-label">Commits</div>
              </div>
              <div className="dashboard-info-card">
                <div className="dashboard-info-value">{overview.languages.length}</div>
                <div className="dashboard-info-label">Languages</div>
              </div>
              <div className="dashboard-info-card">
                <div className="dashboard-info-value">{overview.stats.total_sessions}</div>
                <div className="dashboard-info-label">Sessions</div>
              </div>
            </div>
          </div>

          {/* Tech stack */}
          {overview.tech_stack.length > 0 && (
            <div className="dashboard-section">
              <div className="dashboard-section-label">TECH STACK</div>
              <div className="dashboard-tech-stack">
                {overview.tech_stack.map((tech) => (
                  <div key={tech} className="dashboard-tech-pill">
                    {tech}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Languages */}
          {overview.languages.length > 0 && (
            <div className="dashboard-section">
              <div className="dashboard-section-label">LANGUAGES</div>
              <div className="dashboard-languages">
                {/* Language bar */}
                <div className="dashboard-language-bar">
                  {overview.languages.map((lang) => (
                    <div
                      key={lang.name}
                      className="dashboard-language-segment"
                      style={{
                        width: `${lang.percentage}%`,
                        background: LANGUAGE_COLORS[lang.name] || DEFAULT_LANG_COLOR,
                      }}
                      title={`${lang.name}: ${lang.percentage}%`}
                    />
                  ))}
                </div>
                {/* Language legend */}
                <div className="dashboard-language-legend">
                  {overview.languages.slice(0, 6).map((lang) => (
                    <div key={lang.name} className="dashboard-language-item">
                      <span
                        className="dashboard-language-dot"
                        style={{
                          background: LANGUAGE_COLORS[lang.name] || DEFAULT_LANG_COLOR,
                        }}
                      />
                      <span className="dashboard-language-name">{lang.name}</span>
                      <span className="dashboard-language-percentage">{lang.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CLAUDE.md */}
          {overview.claude_md.exists && (
            <div className="dashboard-section">
              <div className="dashboard-section-label">CLAUDE.MD</div>
              <div className="dashboard-claude-card">
                {overview.claude_md.excerpt || 'Project has Claude Code configuration'}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Recent sessions */}
        <div className="dashboard-column-right">
          {overview.sessions.length > 0 ? (
            <>
              <div className="dashboard-section-label">RECENT SESSIONS</div>
              <div className="dashboard-session-list">
                {overview.sessions.slice(0, 5).map((session) => (
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
      </div>
    </div>
  );
};
