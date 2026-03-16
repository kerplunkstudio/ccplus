import React, { useState } from 'react';
import { AgentNode } from '../types';
import { ToolIcon } from './ToolIcon';
import { formatDuration } from '../utils/formatDuration';
import './AgentCard.css';

interface AgentCardProps {
  node: AgentNode;
  depth: number;
  onSelect: (node: AgentNode) => void;
  children?: React.ReactNode;
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'running':
      return <span className="status-badge status-running">Running</span>;
    case 'completed':
      return <span className="status-badge status-completed">Completed</span>;
    case 'failed':
      return <span className="status-badge status-failed">Failed</span>;
    case 'stopped':
      return <span className="status-badge status-stopped">Stopped</span>;
    default:
      return null;
  }
};

export const AgentCard: React.FC<AgentCardProps> = React.memo(({ node, depth, onSelect, children }) => {
  const [expanded, setExpanded] = useState(false);

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  };

  const handleCardClick = () => {
    onSelect(node);
  };

  const childCount = node.children.length;
  const toolCount = node.children.filter((child) => !('children' in child)).length;
  const agentCount = node.children.filter((child) => 'children' in child).length;

  return (
    <div className="agent-card-container" style={{ '--depth': depth } as React.CSSProperties}>
      <div
        className={`agent-card agent-card-${node.status}`}
        onClick={handleCardClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      >
        {/* Agent type — full width, no competition */}
        <div className="agent-card-type">
          {node.sequence !== undefined && (
            <span className="node-sequence">#{node.sequence}</span>
          )}{' '}
          {node.agent_type}
        </div>

        {/* Description */}
        {node.description && (
          <div className="agent-card-description">{node.description}</div>
        )}

        {/* Summary (only when completed/failed) */}
        {node.summary && node.status !== 'running' && (
          <div className="agent-card-summary">
            {node.summary.length > 150
              ? node.summary.slice(0, 150) + '...'
              : node.summary}
          </div>
        )}

        {/* Meta row: status + duration + child breakdown */}
        <div className="agent-card-meta-row">
          {getStatusBadge(node.status)}
          {node.duration_ms !== undefined && (
            <span className="agent-card-chip">
              {formatDuration(node.duration_ms)}
            </span>
          )}
          {toolCount > 0 && (
            <span className="agent-card-chip">
              {toolCount} tool{toolCount > 1 ? 's' : ''}
            </span>
          )}
          {agentCount > 0 && (
            <span className="agent-card-chip agent-card-chip-accent">
              {agentCount} agent{agentCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Expand toggle */}
        {childCount > 0 && (
          <button
            className="agent-card-toggle"
            onClick={toggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse children' : 'Expand children'}
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor" className={`toggle-arrow ${expanded ? 'expanded' : ''}`}>
              <path d="M3 2L7 5L3 8Z" />
            </svg>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}

        {/* Error */}
        {node.error && (
          <div className="agent-card-error">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 22h20L12 2zm0 3.5L19.5 20h-15L12 5.5zm-1 9.5h2v2h-2v-2zm0-6h2v4h-2V9z" />
            </svg>
            <span>{node.error}</span>
          </div>
        )}
      </div>

      {childCount > 0 && (
        <div className={`agent-card-children-wrapper ${expanded ? 'expanded' : ''}`}>
          <div className="agent-card-children">{children}</div>
        </div>
      )}
    </div>
  );
});
