import React from 'react';
import { ToolNode } from '../types';
import { ToolIcon } from './ToolIcon';
import { formatDuration } from '../utils/formatDuration';
import './ToolRow.css';

interface ToolRowProps {
  node: ToolNode;
  depth: number;
  onSelect: (node: ToolNode) => void;
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

export const ToolRow: React.FC<ToolRowProps> = React.memo(({ node, depth, onSelect }) => {
  const handleClick = () => {
    onSelect(node);
  };

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
          {node.sequence !== undefined && (
            <span className="node-sequence">#{node.sequence}</span>
          )}{' '}
          <span className="tool-row-name">{node.tool_name}</span>
        </div>

        <div className="tool-row-meta">
          {node.duration_ms !== undefined && (
            <span className="tool-row-duration">{formatDuration(node.duration_ms)}</span>
          )}
          <span className="tool-row-status-wrapper" role="status" aria-label={`Status: ${node.status}`}>
            <StatusIcon status={node.status} />
          </span>
        </div>
      </div>
    </div>
  );
});
