import React, { useState, useEffect } from 'react';
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

  const fetchSessions = async () => {
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
  };

  useEffect(() => {
    fetchSessions();
  }, [currentSessionId, selectedProject]);

  const projectName = selectedProject
    ? selectedProject.split('/').filter(Boolean).pop() ?? null
    : null;

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
            <button
              key={session.session_id}
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
          ))
        )}
      </div>
    </div>
  );
};
