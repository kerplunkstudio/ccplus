import React from 'react';
import { ToolNode } from '../types';
import { ToolIcon } from './ToolIcon';
import './ToolRow.css';

interface ToolRowProps {
  node: ToolNode;
  depth: number;
  onSelect: (node: ToolNode) => void;
}

const formatDuration = (ms?: number): string => {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'running':
      return <span className="tool-status-icon tool-status-running" aria-label="Running" />;
    case 'completed':
      return <span className="tool-status-icon tool-status-completed" aria-label="Completed" />;
    case 'failed':
      return <span className="tool-status-icon tool-status-failed" aria-label="Failed" />;
    default:
      return null;
  }
};

export const ToolRow: React.FC<ToolRowProps> = ({ node, depth, onSelect }) => {
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
          <span className="tool-row-name">{node.tool_name}</span>
        </div>

        <div className="tool-row-meta">
          {node.duration_ms !== undefined && (
            <span className="tool-row-duration">{formatDuration(node.duration_ms)}</span>
          )}
          <StatusIcon status={node.status} />
        </div>
      </div>

      {node.error && (
        <div className="tool-row-error">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 22h20L12 2zm-1 13h2v2h-2v-2zm0-6h2v4h-2V9z" />
          </svg>
          <span>{node.error}</span>
        </div>
      )}
    </div>
  );
};
