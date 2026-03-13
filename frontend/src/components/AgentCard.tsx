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
    default:
      return null;
  }
};

export const AgentCard: React.FC<AgentCardProps> = ({ node, depth, onSelect, children }) => {
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
        <div className="agent-card-header">
          <div className="agent-card-title-area">
            <div className="agent-card-icon">
              <ToolIcon toolName="Agent" size={16} />
            </div>
            <div className="agent-card-info">
              <div className="agent-card-type">
                {node.sequence !== undefined && (
                  <span className="node-sequence">#{node.sequence}</span>
                )}{' '}
                {node.agent_type}
              </div>
              {node.description && (
                <div className="agent-card-description">{node.description}</div>
              )}
            </div>
          </div>
          <div className="agent-card-meta">
            {node.duration_ms !== undefined && (
              <span className="agent-card-duration">{formatDuration(node.duration_ms)}</span>
            )}
            {getStatusBadge(node.status)}
          </div>
        </div>

        {childCount > 0 && (
          <div className="agent-card-footer">
            <button
              className="agent-card-toggle"
              onClick={toggleExpand}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse children' : 'Expand children'}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 10 10"
                fill="currentColor"
                className={`toggle-arrow ${expanded ? 'expanded' : ''}`}
              >
                <path d="M3 2L7 5L3 8Z" />
              </svg>
              <span className="agent-card-child-count">
                {toolCount > 0 && `${toolCount} tool${toolCount > 1 ? 's' : ''}`}
                {toolCount > 0 && agentCount > 0 && ', '}
                {agentCount > 0 && `${agentCount} agent${agentCount > 1 ? 's' : ''}`}
              </span>
            </button>
          </div>
        )}

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
};
