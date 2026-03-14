import React, { useEffect, useState } from 'react';
import { ActivityNode, isAgentNode } from '../types';
import './ActivityNodeEnhanced.css';

interface ActivityNodeEnhancedProps {
  node: ActivityNode;
  depth: number;
  isNew?: boolean;
  onSelect?: (node: ActivityNode) => void;
}

const TOOL_METADATA: Record<string, { emoji: string; color: string; description: string }> = {
  'Agent': { emoji: '🤖', color: 'var(--accent)', description: 'Intelligent agent' },
  'Read': { emoji: '📖', color: '#4F46E5', description: 'Reading file' },
  'Edit': { emoji: '✏️', color: '#059669', description: 'Editing content' },
  'Write': { emoji: '📝', color: '#DC2626', description: 'Creating file' },
  'Bash': { emoji: '⚡', color: '#F59E0B', description: 'Running command' },
  'Grep': { emoji: '🔍', color: '#8B5CF6', description: 'Searching patterns' },
  'Glob': { emoji: '🗂️', color: '#EC4899', description: 'Finding files' },
  'default': { emoji: '⚙️', color: 'var(--text-secondary)', description: 'Tool execution' }
};

export const ActivityNodeEnhanced: React.FC<ActivityNodeEnhancedProps> = ({
  node,
  depth,
  isNew = false,
  onSelect
}) => {
  const [animationPhase, setAnimationPhase] = useState<'enter' | 'pulse' | 'stable'>('enter');
  const [statusChange, setStatusChange] = useState<'running' | 'completed' | 'failed' | null>(null);

  const isAgent = isAgentNode(node);
  const toolMeta = TOOL_METADATA[node.tool_name] || TOOL_METADATA.default;

  // Handle status changes with animations
  useEffect(() => {
    if (node.status === 'completed' || node.status === 'failed') {
      setStatusChange(node.status);
      setTimeout(() => setStatusChange(null), 800);
    }
  }, [node.status]);

  // Handle entrance animations
  useEffect(() => {
    if (isNew) {
      setTimeout(() => setAnimationPhase('pulse'), 200);
      setTimeout(() => setAnimationPhase('stable'), 800);
    }
  }, [isNew]);

  const handleClick = () => {
    onSelect?.(node);
  };

  return (
    <div
      className={`
        activity-node-enhanced
        ${isAgent ? 'agent' : 'tool'}
        ${node.status}
        ${animationPhase}
        ${statusChange ? `status-${statusChange}` : ''}
        ${isNew ? 'new' : ''}
      `}
      style={{ '--depth': depth } as React.CSSProperties}
      onClick={handleClick}
    >
      {/* Connection line */}
      {depth > 0 && <div className="connection-line" />}

      {/* Node content */}
      <div className="node-content">
        {/* Status indicator */}
        <div className="status-indicator">
          <div className="status-dot" />
          {node.status === 'running' && <div className="pulse-ring" />}
        </div>

        {/* Tool icon */}
        <div className="tool-icon" style={{ '--tool-color': toolMeta.color } as React.CSSProperties}>
          <span className="icon-emoji">{toolMeta.emoji}</span>
          {node.status === 'running' && <div className="icon-shimmer" />}
        </div>

        {/* Node details */}
        <div className="node-details">
          <div className="node-header">
            <span className="tool-name">{node.tool_name}</span>
            {node.duration_ms && (
              <span className="duration">
                {node.duration_ms < 1000
                  ? `${Math.round(node.duration_ms)}ms`
                  : `${(node.duration_ms / 1000).toFixed(1)}s`
                }
              </span>
            )}
          </div>

          {isAgent && 'description' in node && node.description && (
            <div className="agent-description">{node.description}</div>
          )}

          {!isAgent && 'parameters' in node && node.parameters && (
            <div className="tool-parameters">
              {Object.entries(node.parameters as Record<string, any>)
                .slice(0, 2)
                .map(([key, value]) => (
                  <div key={key} className="parameter">
                    <span className="param-key">{key}:</span>
                    <span className="param-value">
                      {typeof value === 'string' ? value.slice(0, 40) : JSON.stringify(value).slice(0, 40)}
                      {(typeof value === 'string' ? value.length : JSON.stringify(value).length) > 40 && '...'}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {node.error && (
            <div className="error-message">
              {node.error.slice(0, 100)}
              {node.error.length > 100 && '...'}
            </div>
          )}
        </div>
      </div>

      {/* Success/failure celebration */}
      {statusChange && (
        <div className={`status-celebration ${statusChange}`}>
          {statusChange === 'completed' && (
            <>
              <div className="success-icon">✨</div>
              <div className="celebration-particles">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="particle" style={{ '--delay': `${i * 0.1}s` } as React.CSSProperties} />
                ))}
              </div>
            </>
          )}
          {statusChange === 'failed' && (
            <div className="error-icon">⚠️</div>
          )}
        </div>
      )}

      {/* Children for agents */}
      {isAgent && 'children' in node && node.children.length > 0 && (
        <div className="children-container">
          {node.children.map((child) => (
            <ActivityNodeEnhanced
              key={child.tool_use_id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};