import React from 'react';
import { UsageStats } from '../types';
import './UsageStatsBar.css';

interface UsageStatsBarProps {
  stats: UsageStats;
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
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

export const UsageStatsBar: React.FC<UsageStatsBarProps> = ({ stats }) => {
  return (
    <div className="usage-stats-bar">
      <div className="usage-stat">
        <span className="usage-stat-label">Sessions</span>
        <span className="usage-stat-value">{stats.totalSessions}</span>
      </div>
      <div className="usage-stat">
        <span className="usage-stat-label">Time</span>
        <span className="usage-stat-value">{formatDuration(stats.totalDuration)}</span>
      </div>
      <div className="usage-stat">
        <span className="usage-stat-label">Lines of code</span>
        <span className="usage-stat-value">{formatNumber(stats.linesOfCode)}</span>
      </div>
    </div>
  );
};
