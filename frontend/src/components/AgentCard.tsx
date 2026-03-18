import React, { useState, useEffect } from 'react';
import { AgentNode } from '../types';
import { formatDuration } from '../utils/formatDuration';
import './AgentCard.css';

interface AgentCardProps {
  node: AgentNode;
  depth: number;
  onSelect: (node: AgentNode) => void;
  children?: React.ReactNode;
}

/**
 * Extracts the first sentence from text, falling back to first 120 chars at word boundary.
 */
const truncateSummary = (text: string, maxLength: number = 200): string => {
  // Strip leading markdown headers/whitespace
  const cleaned = text.replace(/^[\s#*-]+/, '').trim();
  if (!cleaned) return text.substring(0, maxLength);

  // Find first sentence-ending punctuation
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  if (match && match[1].length <= maxLength) return match[1];

  // Fallback: cut at word boundary
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.7 ? truncated.substring(0, lastSpace) : truncated) + '...';
};

export const AgentCard: React.FC<AgentCardProps> = React.memo(({ node, depth, onSelect, children }) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(undefined);

  // Running state: track elapsed time
  useEffect(() => {
    if (node.status === 'running' && node.duration_ms === undefined && node.timestamp) {
      const startTime = new Date(node.timestamp).getTime();

      const updateElapsed = () => {
        const now = Date.now();
        setElapsedMs(now - startTime);
      };

      updateElapsed();
      const interval = setInterval(updateElapsed, 1000);

      return () => clearInterval(interval);
    } else {
      setElapsedMs(undefined);
    }
  }, [node.status, node.duration_ms, node.timestamp]);

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

  // Determine which duration to show: completed duration or elapsed time
  const displayDuration = node.duration_ms !== undefined ? node.duration_ms : elapsedMs;

  // Build meta line parts
  const metaParts: string[] = [];
  if (displayDuration !== undefined) {
    metaParts.push(formatDuration(displayDuration));
  }
  if (toolCount > 0) {
    metaParts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`);
  }
  if (agentCount > 0) {
    metaParts.push(`${agentCount} agent${agentCount > 1 ? 's' : ''}`);
  }

  return (
    <div className="agent-card-container" style={{ '--depth': depth } as React.CSSProperties}>
      <div
        className={`agent-card agent-card-${node.status}`}
        onClick={handleCardClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      >
        {/* Agent type — subtle label above description */}
        {node.description ? (
          <div className="agent-card-type">
            {node.sequence !== undefined && `#${node.sequence} `}
            {node.agent_type}
          </div>
        ) : (
          <div className="agent-card-type agent-card-type-primary">
            {node.sequence !== undefined && `#${node.sequence} `}
            {node.agent_type}
          </div>
        )}

        {/* Description — primary text when present */}
        {node.description && (
          <div className="agent-card-description">{node.description}</div>
        )}

        {/* Summary preview (truncated, always visible when summary exists and not running) */}
        {node.summary && node.status !== 'running' && !expanded && (
          <div className="agent-summary-preview">
            {truncateSummary(node.summary)}
          </div>
        )}

        {/* Summary full (only when expanded) */}
        {node.summary && node.status !== 'running' && expanded && (
          <div className="agent-summary-full">
            {node.summary}
          </div>
        )}

        {/* Meta line: plain text metadata */}
        {metaParts.length > 0 && (
          <div className="agent-card-meta">
            {metaParts.map((part, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="agent-card-meta-sep">·</span>}
                {part}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Expand toggle */}
        {childCount > 0 && (
          <button
            className="agent-card-toggle"
            onClick={toggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse children' : 'Expand children'}
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor" className={`toggle-arrow ${expanded ? 'expanded' : ''}`} aria-hidden="true">
              <path d="M3 2L7 5L3 8Z" />
            </svg>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
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
