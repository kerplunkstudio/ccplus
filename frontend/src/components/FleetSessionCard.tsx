import React from 'react';
import { FleetSession } from '../types';
import './FleetSessionCard.css';

interface FleetSessionCardProps {
  session: FleetSession;
  onClick: (sessionId: string) => void;
}

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

const formatTokens = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(1)}M`;
};

const shortenPath = (path: string): string => {
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-2).join('/')}`;
};

export const FleetSessionCard: React.FC<FleetSessionCardProps> = ({ session, onClick }) => {
  const statusClass = `status-${session.status}`;
  const label = session.label || session.sessionId.slice(0, 12);
  const truncatedLabel = label.length > 60 ? label.slice(0, 60) + '...' : label;
  const totalTokens = session.inputTokens + session.outputTokens;

  return (
    <div className="fleet-session-card" onClick={() => onClick(session.sessionId)}>
      <div className="fleet-card-header">
        <div className={`fleet-status-badge ${statusClass}`} />
        <div className="fleet-card-label">{truncatedLabel}</div>
      </div>

      <div className="fleet-card-stats">
        <div className="fleet-stat">
          <span className="fleet-stat-label">tools</span>
          <span className="fleet-stat-value">{session.toolCount}</span>
        </div>
        <div className="fleet-stat">
          <span className="fleet-stat-label">agents</span>
          <span className="fleet-stat-value">{session.activeAgents}</span>
        </div>
        <div className="fleet-stat">
          <span className="fleet-stat-label">time</span>
          <span className="fleet-stat-value">{formatDuration(session.durationMs)}</span>
        </div>
      </div>

      <div className="fleet-card-tokens">
        {formatTokens(totalTokens)} tokens
        <span className="fleet-token-detail">
          ({formatTokens(session.inputTokens)} in / {formatTokens(session.outputTokens)} out)
        </span>
      </div>

      <div className="fleet-card-workspace">{shortenPath(session.workspace)}</div>
    </div>
  );
};
