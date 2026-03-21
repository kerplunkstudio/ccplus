import React, { useState } from 'react';
import { ToolNode } from '../types';
import { ToolGroup } from '../utils/toolGrouping';
import { ToolIcon } from './ToolIcon';
import { ToolRow } from './ToolRow';
import './ToolGroupRow.css';

interface ToolGroupRowProps {
  group: ToolGroup;
  depth: number;
  onSelect: (node: ToolNode) => void;
  currentTime?: number;
  workspacePath?: string;
}

export const ToolGroupRow: React.FC<ToolGroupRowProps> = ({
  group,
  depth,
  onSelect,
  currentTime,
  workspacePath,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-group-container" style={{ '--depth': depth } as React.CSSProperties}>
      <div
        className={`tool-group-row tool-group-${group.status}`}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        <div className="tool-row-connector">
          <span className="tool-row-line" />
          <span className="tool-row-dot" />
        </div>
        <div className="tool-row-icon">
          <ToolIcon toolName={group.tool_name} size={14} />
        </div>
        <div className="tool-group-info">
          <span className="tool-row-name">{group.tool_name}</span>
          <span className="tool-group-count">×{group.nodes.length}</span>
        </div>
        <div className="tool-group-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </div>
      </div>
      {expanded && (
        <div className="tool-group-children">
          {group.nodes.map((node) => (
            <ToolRow
              key={node.tool_use_id}
              node={node}
              depth={depth + 1}
              onSelect={onSelect}
              currentTime={currentTime}
              workspacePath={workspacePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};
