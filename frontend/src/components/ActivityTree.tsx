import React, { useState, useEffect, useRef } from 'react';
import { ActivityNode, isAgentNode } from '../types';
import './ActivityTree.css';

interface ActivityTreeProps {
  tree: ActivityNode[];
}

interface TreeNodeProps {
  node: ActivityNode;
  depth: number;
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
      return <span className="status-icon spinning" aria-label="Running" />;
    case 'completed':
      return <span className="status-icon completed" aria-label="Completed" />;
    case 'failed':
      return <span className="status-icon failed" aria-label="Failed" />;
    default:
      return null;
  }
};

const TreeNode: React.FC<TreeNodeProps> = ({ node, depth }) => {
  const [expanded, setExpanded] = useState(true);
  const isAgent = isAgentNode(node);

  const toggleExpand = () => {
    if (isAgent) {
      setExpanded((prev) => !prev);
    }
  };

  return (
    <div className="tree-node" style={{ '--depth': depth } as React.CSSProperties}>
      <div
        className={`node-row ${isAgent ? 'agent-row' : 'tool-row'} ${node.status}`}
        onClick={toggleExpand}
        role={isAgent ? 'button' : undefined}
        aria-expanded={isAgent ? expanded : undefined}
      >
        <div className="node-indent">
          {depth > 0 && <span className="tree-line" />}
        </div>

        {isAgent && (
          <span className={`expand-arrow ${expanded ? 'expanded' : ''}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2L7 5L3 8Z" />
            </svg>
          </span>
        )}

        <span className="node-icon">{isAgent ? '\uD83E\uDD16' : '\uD83D\uDD27'}</span>

        <div className="node-info">
          <span className="node-name">
            {isAgent ? (node as any).agent_type : node.tool_name}
          </span>
          {isAgent && (node as any).description && (
            <span className="node-description">{(node as any).description}</span>
          )}
        </div>

        <div className="node-status-area">
          {node.duration_ms !== undefined && (
            <span className="node-duration">{formatDuration(node.duration_ms)}</span>
          )}
          <StatusIcon status={node.status} />
        </div>
      </div>

      {isAgent && expanded && (node as any).children.length > 0 && (
        <div className="node-children">
          {(node as any).children.map((child: ActivityNode) => (
            <TreeNode key={child.tool_use_id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}

      {node.error && (
        <div className="node-error" style={{ marginLeft: `${(depth + 1) * 20 + 28}px` }}>
          {node.error}
        </div>
      )}
    </div>
  );
};

export const ActivityTree: React.FC<ActivityTreeProps> = ({ tree }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest activity
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [tree]);

  return (
    <div className="activity-tree">
      <div className="activity-header">
        <h2 className="activity-title">Activity</h2>
        {tree.length > 0 && (
          <span className="activity-count">{tree.length}</span>
        )}
      </div>

      <div className="activity-content" ref={containerRef}>
        {tree.length === 0 ? (
          <div className="activity-empty">
            <div className="activity-empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
            </div>
            <p className="activity-empty-text">No activity yet</p>
            <p className="activity-empty-sub">Tool usage and agent activity will appear here</p>
          </div>
        ) : (
          <div className="tree-root">
            {tree.map((node) => (
              <TreeNode key={node.tool_use_id} node={node} depth={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
