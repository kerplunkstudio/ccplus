import React, { useState, useEffect, useMemo } from 'react';
import { UsageStats } from '../types';
import { useProfile } from './ProfilePanel';
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

const getGreeting = (): string => {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const isSaturday = day === 6;
  const isSunday = day === 0;

  // Seed from date + time-of-day slot so greeting is stable
  // within the same time period but varies day to day
  const timeSlot = hour < 5 ? 0 : hour < 12 ? 1 : hour < 17 ? 2 : hour < 21 ? 3 : 4;
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const pick = (pool: string[]) => pool[(seed + timeSlot) % pool.length];

  const greetings = {
    morning: [
      'Good morning',
      'Rise and build',
      'Fresh start',
      'Morning session',
      'Early start',
    ],
    afternoon: [
      'Good afternoon',
      'Afternoon session',
      'Back at it',
      'Midday momentum',
      'Afternoon flow',
    ],
    evening: [
      'Evening session',
      'Winding down?',
      'One more thing?',
      'Evening energy',
      'Almost there',
    ],
    lateNight: [
      'Late night coding',
      'Burning the midnight oil',
      'Night owl mode',
      'After hours',
      'Deep work hours',
    ],
    saturday: [
      'Saturday session?',
      'Weekend warrior',
      'Saturday vibes',
      'Weekend deep dive',
      'Saturday energy',
    ],
    sunday: [
      'Sunday session?',
      'Sunday vibes',
      'Lazy Sunday coding',
      'Sunday deep dive',
      'Easy Sunday',
    ],
  };

  if (isSaturday) return pick(greetings.saturday);
  if (isSunday) return pick(greetings.sunday);
  if (hour >= 5 && hour < 12) return pick(greetings.morning);
  if (hour >= 12 && hour < 17) return pick(greetings.afternoon);
  if (hour >= 17 && hour < 21) return pick(greetings.evening);
  return pick(greetings.lateNight);
};

export const NewSessionDashboard: React.FC<NewSessionDashboardProps> = ({
  projectPath,
  usageStats,
  pastSessions,
  onLoadSession,
}) => {
  const [gitContext, setGitContext] = useState<GitContext | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const profile = useProfile();

  // Generate greeting once per component mount
  const baseGreeting = useMemo(() => getGreeting(), []);
  const greeting = profile.name
    ? `${baseGreeting}, ${profile.name}`
    : baseGreeting;

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
      {/* Welcome greeting */}
      <div className="welcome-greeting">
        <span className="greeting-decoration">✦</span>
        <span className="greeting-text">{greeting}</span>
      </div>

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
