import React, { useState, useEffect, useCallback } from 'react';
import './SessionSwitcher.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';

interface SessionInfo {
  session_id: string;
  message_count: number;
  last_activity: string;
  last_user_message: string | null;
  project_path?: string | null;
}

interface SessionSwitcherProps {
  currentSessionId: string;
  selectedProject?: string | null;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
}

const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

export const SessionSwitcher: React.FC<SessionSwitcherProps> = ({
  currentSessionId,
  selectedProject,
  onSwitchSession,
  onNewSession,
}) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const fetchSessions = useCallback(async () => {
    try {
      const url = selectedProject
        ? `${SOCKET_URL}/api/sessions?project=${encodeURIComponent(selectedProject)}`
        : `${SOCKET_URL}/api/sessions`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // silently fail
    }
  }, [selectedProject]);

  useEffect(() => {
    fetchSessions();
  }, [currentSessionId, selectedProject, fetchSessions]);

  const projectName = selectedProject
    ? selectedProject.split('/').filter(Boolean).pop() ?? null
    : null;

  const handleArchive = (e: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
    e.stopPropagation();
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';
    fetch(`${SOCKET_URL}/api/sessions/${sessionId}/archive`, {
      method: 'POST',
    }).then(() => {
      fetchSessions();
    }).catch((err) => {
      console.error('Failed to archive session:', err);
    });
  };

  return (
    <div className="session-switcher">
      <div className="session-switcher-header">
        <h2 className="session-switcher-title">Sessions</h2>
        <button
          className="session-new-btn"
          onClick={onNewSession}
          title="New session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {projectName && (
        <div className="session-project-filter">
          <span className="session-project-filter-label">{projectName}</span>
        </div>
      )}

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="session-empty">
            {projectName ? `No sessions for ${projectName}` : 'No sessions yet'}
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.session_id}
              className={`session-item-wrapper ${session.session_id === currentSessionId ? 'active' : ''}`}
            >
              <button
                className={`session-item ${session.session_id === currentSessionId ? 'active' : ''}`}
                onClick={() => onSwitchSession(session.session_id)}
              >
                <div className="session-item-preview">
                  {session.last_user_message || 'Empty session'}
                </div>
                <div className="session-item-meta">
                  <span className="session-item-count">{session.message_count} msgs</span>
                  <span className="session-item-time">{formatTime(session.last_activity)}</span>
                </div>
              </button>
              <button
                className="session-archive-btn"
                onClick={(e) => handleArchive(e, session.session_id)}
                title="Archive session"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <line x1="1" y1="3" x2="23" y2="3" />
                  <path d="M10 12v5M14 12v5" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
