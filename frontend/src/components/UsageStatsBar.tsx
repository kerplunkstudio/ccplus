import React from 'react';
import { UsageStats } from '../types';
import './UsageStatsBar.css';

interface UsageStatsBarProps {
  stats: UsageStats;
  totalTools?: number;
  elapsed?: string;
  errorCount?: number;
  hasRunning?: boolean;
  contextTokens?: number | null;
}

export const UsageStatsBar: React.FC<UsageStatsBarProps> = ({
  stats,
  totalTools,
  elapsed,
  errorCount = 0,
  hasRunning = false,
  contextTokens,
}) => {
  const showActivityStats = totalTools !== undefined && elapsed !== undefined;

  if (!showActivityStats) {
    return (
      <div className="usage-stats-bar">
        <div className="usage-stat">
          <span className="usage-stat-value">{stats.totalSessions}</span>
          <span className="usage-stat-label">SESS</span>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-value">{stats.model}</span>
          <span className="usage-stat-label">MODEL</span>
        </div>
      </div>
    );
  }

  // Calculate context usage percentage
  const contextPercent = contextTokens != null && stats.contextWindowSize > 0
    ? Math.round((contextTokens / stats.contextWindowSize) * 100)
    : null;

  // Determine color class based on percentage
  const contextColorClass = contextPercent !== null && contextPercent >= 75
    ? 'context-danger'
    : contextPercent !== null && contextPercent >= 50
      ? 'context-warn'
      : '';

  return (
    <div className="usage-stats-bar">
      <div className="usage-stat">
        <span className="usage-stat-value">{totalTools}</span>
        <span className="usage-stat-label">TOOLS</span>
      </div>
      <div className="usage-stat">
        <span className={`usage-stat-value ${hasRunning ? 'usage-stat-pulse' : ''}`}>
          {elapsed}
        </span>
        <span className="usage-stat-label">ELAPSED</span>
      </div>
      {errorCount > 0 ? (
        <div className="usage-stat">
          <span className="usage-stat-value usage-stat-error">{errorCount}</span>
          <span className="usage-stat-label">ERRORS</span>
        </div>
      ) : (
        <div className="usage-stat">
          <span className={`usage-stat-value ${contextColorClass}`}>
            {contextPercent !== null ? `${contextPercent}%` : '—'}
          </span>
          <div className="context-bar">
            <div className={`context-bar-fill ${contextColorClass}`} style={{ width: `${contextPercent ?? 0}%` }} />
          </div>
          <span className="usage-stat-label">CONTEXT</span>
        </div>
      )}
    </div>
  );
};
