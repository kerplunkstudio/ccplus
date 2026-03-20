import React from 'react';
import { FleetAggregateStats as FleetAggregateStatsType } from '../types';
import './FleetAggregateStats.css';

interface FleetAggregateStatsProps {
  aggregate: FleetAggregateStatsType;
}

const formatTokens = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(1)}M`;
};

export const FleetAggregateStats: React.FC<FleetAggregateStatsProps> = ({ aggregate }) => {
  return (
    <div className="fleet-aggregate-stats">
      <div className="fleet-aggregate-stat">
        <span className="fleet-aggregate-label">Active</span>
        <span className="fleet-aggregate-value">
          {aggregate.activeSessions} / {aggregate.totalSessions}
        </span>
      </div>

      <div className="fleet-aggregate-divider" />

      <div className="fleet-aggregate-stat">
        <span className="fleet-aggregate-label">Tools</span>
        <span className="fleet-aggregate-value">{aggregate.totalToolCalls}</span>
      </div>

      <div className="fleet-aggregate-divider" />

      <div className="fleet-aggregate-stat">
        <span className="fleet-aggregate-label">Tokens</span>
        <span className="fleet-aggregate-value">
          {formatTokens(aggregate.totalInputTokens)} in / {formatTokens(aggregate.totalOutputTokens)} out
        </span>
      </div>
    </div>
  );
};
