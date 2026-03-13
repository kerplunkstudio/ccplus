import React from 'react';
import { UsageStats } from '../types';
import './UsageStatsBar.css';

interface UsageStatsBarProps {
  stats: UsageStats;
}

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatCost = (cost: number): string => {
  return `$${cost.toFixed(4)}`;
};

const formatTotalDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

export const UsageStatsBar: React.FC<UsageStatsBarProps> = ({ stats }) => {
  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
  const contextPercent = Math.min(100, (totalTokens / stats.contextWindowSize) * 100);
  const contextRemaining = Math.max(0, stats.contextWindowSize - totalTokens);

  const getContextBarColor = (): string => {
    if (contextPercent > 80) return 'var(--error)';
    if (contextPercent > 60) return 'var(--warning)';
    return 'var(--accent)';
  };

  return (
    <div className="usage-stats-bar">
      <div className="usage-stat">
        <span className="usage-stat-label">Cost</span>
        <span className="usage-stat-value">{formatCost(stats.totalCost)}</span>
      </div>
      <div className="usage-stat">
        <span className="usage-stat-label">Tokens</span>
        <span className="usage-stat-value">
          {formatTokens(stats.totalInputTokens)}↑ {formatTokens(stats.totalOutputTokens)}↓
        </span>
      </div>
      <div className="usage-stat">
        <span className="usage-stat-label">Queries</span>
        <span className="usage-stat-value">{stats.queryCount}</span>
      </div>
      <div className="usage-stat">
        <span className="usage-stat-label">Time</span>
        <span className="usage-stat-value">{formatTotalDuration(stats.totalDuration)}</span>
      </div>
      <div className="usage-stat context-bar-container">
        <span className="usage-stat-label">Context</span>
        <div className="context-bar">
          <div
            className="context-bar-fill"
            style={{
              transform: `scaleX(${contextPercent / 100})`,
              backgroundColor: getContextBarColor(),
            }}
          />
        </div>
        <span className={`context-bar-label ${contextPercent > 80 ? 'context-warning' : ''}`}>
          {contextPercent > 80
            ? `${Math.round(contextPercent)}% — getting tight`
            : `${formatTokens(contextRemaining)} left`}
        </span>
      </div>
    </div>
  );
};
