import React from 'react';
import { ToolNode } from '../types';
import { ToolIcon } from './ToolIcon';
import { formatDuration } from '../utils/formatDuration';
import { getToolSubtitle } from '../utils/toolSubtitle';
import './ToolRow.css';

interface ToolRowProps {
  node: ToolNode;
  depth: number;
  onSelect: (node: ToolNode) => void;
  currentTime?: number;
  workspacePath?: string;
}

function formatLiveElapsed(ms: number): string {
  if (ms < 1000) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'running':
      return <span className="tool-status-icon tool-status-running" aria-hidden="true" />;
    case 'completed':
      return <span className="tool-status-icon tool-status-completed" aria-hidden="true" />;
    case 'failed':
      return <span className="tool-status-icon tool-status-failed" aria-hidden="true" />;
    case 'stopped':
      return <span className="tool-status-icon tool-status-stopped" aria-hidden="true" />;
    default:
      return null;
  }
};

const areEqual = (prev: ToolRowProps, next: ToolRowProps): boolean => {
  if (prev.node !== next.node) return false;
  if (prev.node.status === 'running' && prev.currentTime !== next.currentTime) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.workspacePath !== next.workspacePath) return false;
  return true;
};

export const ToolRow: React.FC<ToolRowProps> = React.memo(({ node, depth, onSelect, currentTime, workspacePath }) => {
  const handleClick = () => {
    onSelect(node);
  };

  const subtitle = node.status === 'failed' && node.error
    ? node.error
    : getToolSubtitle(node, workspacePath);

  const isRunning = node.status === 'running';
  const showLiveTimer = isRunning && currentTime !== undefined;
  const elapsedMs = showLiveTimer ? currentTime - new Date(node.timestamp).getTime() : 0;

  return (
    <div
      className="tool-row-container"
      style={{ '--depth': depth } as React.CSSProperties}
    >
      <div
        className={`tool-row tool-row-${node.status}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      >
        <div className="tool-row-connector">
          <span className="tool-row-line" />
          <span className="tool-row-dot" />
        </div>

        <div className="tool-row-icon">
          <ToolIcon toolName={node.tool_name} size={14} />
        </div>

        <div className="tool-row-info">
          <div className="tool-row-info-header">
            {node.sequence !== undefined && (
              <span className="node-sequence">#{node.sequence}</span>
            )}{' '}
            <span className="tool-row-name">{node.tool_name}</span>
          </div>
          {subtitle && (
            <span className={node.status === 'failed' && node.error ? 'tool-row-error-hint' : 'tool-row-subtitle'}>
              {subtitle}
            </span>
          )}
        </div>

        <div className="tool-row-meta">
          {showLiveTimer ? (
            <span className="tool-row-live-timer">{formatLiveElapsed(elapsedMs)}</span>
          ) : node.duration_ms !== undefined ? (
            <span className="tool-row-duration">{formatDuration(node.duration_ms)}</span>
          ) : null}
          <span className="tool-row-status-wrapper" role="status" aria-label={`Status: ${node.status}`}>
            <StatusIcon status={node.status} />
          </span>
        </div>
      </div>
    </div>
  );
}, areEqual);
