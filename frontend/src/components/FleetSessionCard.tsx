import React, { useState, useEffect } from 'react';
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

const getProjectName = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
};

const STATUS_LABELS: Record<string, string> = {
  running: 'running',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  pending: 'Awaiting approval',
};

const getStatusLabel = (session: FleetSession): string => {
  if (session.status === 'running' && session.workflowPhase && session.workflowPhase !== 'idle') {
    return session.workflowPhase.charAt(0).toUpperCase() + session.workflowPhase.slice(1);
  }
  return STATUS_LABELS[session.status] ?? session.status;
};

export const FleetSessionCard: React.FC<FleetSessionCardProps> = ({ session, onClick }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if ((session.status === 'running' || session.status === 'pending') && session.startedAt) {
      const startTime = new Date(session.startedAt).getTime();
      // Guard against invalid dates (returns NaN)
      if (!isNaN(startTime)) {
        const update = () => setElapsed(Date.now() - startTime);
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
      }
    }
    setElapsed(session.durationMs);
  }, [session.status, session.startedAt, session.durationMs]);

  const statusClass = `status-${session.status}`;
  const label = session.label || session.sessionId.slice(0, 12);
  const truncatedLabel = label.length > 80 ? label.slice(0, 80) + '…' : label;
  const totalTokens = session.inputTokens + session.outputTokens;
  const projectName = getProjectName(session.workspace);
  const statusLabel = getStatusLabel(session);
  const showWorkflow = session.workflowName && session.workflowName !== 'default';

  // Use description if available, otherwise fall back to label
  const primaryText = session.description || truncatedLabel;
  const showSecondaryId = !!session.description;

  const elapsedDisplay = formatDuration(elapsed);

  return (
    <div className={`fleet-session-card ${statusClass}`} onClick={() => onClick(session.sessionId)}>
      <div className="fleet-card-header">
        {session.sessionNumber && (
          <div className="fleet-session-number">#{session.sessionNumber}</div>
        )}
        <div className="fleet-card-project" title={session.workspace}>
          {projectName}
        </div>
        <div className={`fleet-status-pill ${statusClass}`}>
          <span className="fleet-status-dot" />
          {statusLabel}
        </div>
      </div>

      <div className="fleet-card-label">{primaryText}</div>
      {showSecondaryId && (
        <div className="fleet-card-session-id">{truncatedLabel}</div>
      )}

      {showWorkflow && (
        <div className="fleet-card-workflow">{session.workflowName}</div>
      )}

      <div className="fleet-card-divider" />

      <div className="fleet-card-stats">
        <div className="fleet-stat">
          <span className="fleet-stat-value">{session.toolCount}</span>
          <span className="fleet-stat-label">tools</span>
        </div>
        <div className="fleet-stat">
          <span className="fleet-stat-value">
            {session.totalAgents}
          </span>
          <span className="fleet-stat-label">agents</span>
        </div>
        <div className="fleet-stat">
          <span className="fleet-stat-value">{elapsedDisplay}</span>
          <span className="fleet-stat-label">elapsed</span>
        </div>
      </div>

      <div className="fleet-card-tokens">
        <span className="fleet-token-total">{formatTokens(totalTokens)}</span>
        <span className="fleet-token-detail">{formatTokens(session.inputTokens)} in · {formatTokens(session.outputTokens)} out</span>
      </div>
    </div>
  );
};
