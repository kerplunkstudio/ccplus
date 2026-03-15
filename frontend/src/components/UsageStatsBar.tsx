import React from 'react';
import { UsageStats } from '../types';
import './UsageStatsBar.css';

interface UsageStatsBarProps {
  stats: UsageStats;
  totalTools?: number;
  elapsed?: string;
  errorCount?: number;
  hasRunning?: boolean;
}

export const UsageStatsBar: React.FC<UsageStatsBarProps> = ({
  stats,
  totalTools,
  elapsed,
  errorCount = 0,
  hasRunning = false,
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
          <span className="usage-stat-value">{stats.model}</span>
          <span className="usage-stat-label">MODEL</span>
        </div>
      )}
    </div>
  );
};
