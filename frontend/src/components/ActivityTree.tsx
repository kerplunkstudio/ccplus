import React, { useState, useEffect, useRef } from 'react';
import { ActivityNode, isAgentNode, AgentNode, ToolNode, UsageStats } from '../types';
import { AgentCard } from './AgentCard';
import { ToolRow } from './ToolRow';
import { NodeDetail } from './NodeDetail';
import { UsageStatsBar } from './UsageStatsBar';
import './ActivityTree.css';

interface ActivityTreeProps {
  tree: ActivityNode[];
  usageStats: UsageStats;
}

interface TreeNodeProps {
  node: ActivityNode;
  depth: number;
  onNodeSelect: (node: ActivityNode) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, depth, onNodeSelect }) => {
  const isAgent = isAgentNode(node);

  if (isAgent) {
    const agentNode = node as AgentNode;
    return (
      <AgentCard
        node={agentNode}
        depth={depth}
        onSelect={onNodeSelect}
      >
        {agentNode.children.map((child) => (
          <TreeNode
            key={child.tool_use_id}
            node={child}
            depth={depth + 1}
            onNodeSelect={onNodeSelect}
          />
        ))}
      </AgentCard>
    );
  }

  return (
    <ToolRow
      node={node as ToolNode}
      depth={depth}
      onSelect={onNodeSelect}
    />
  );
};

export const ActivityTree: React.FC<ActivityTreeProps> = ({ tree, usageStats }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<ActivityNode | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'tools'>('agents');

  const agentNodes = tree.filter(isAgentNode);
  const toolNodes = tree.filter((n) => !isAgentNode(n)) as ToolNode[];
  const visibleNodes = activeTab === 'agents' ? agentNodes : toolNodes;

  // Auto-scroll to latest activity (only when not viewing details)
  useEffect(() => {
    if (containerRef.current && !selectedNode) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [tree, selectedNode]);

  const handleNodeSelect = (node: ActivityNode) => {
    setSelectedNode(node);
  };

  const handleCloseDetail = () => {
    setSelectedNode(null);
  };

  return (
    <div className="activity-tree">
      {selectedNode ? (
        <NodeDetail node={selectedNode} onClose={handleCloseDetail} />
      ) : (
        <>
          <div className="activity-header">
            <div className="activity-tabs" role="tablist" aria-label="Activity views">
              <button
                className={`activity-tab ${activeTab === 'agents' ? 'activity-tab-active' : ''}`}
                onClick={() => setActiveTab('agents')}
                role="tab"
                aria-selected={activeTab === 'agents'}
                aria-controls="activity-panel-agents"
              >
                Agents{agentNodes.length > 0 && <span className="activity-tab-count">{agentNodes.length}</span>}
              </button>
              <button
                className={`activity-tab ${activeTab === 'tools' ? 'activity-tab-active' : ''}`}
                onClick={() => setActiveTab('tools')}
                role="tab"
                aria-selected={activeTab === 'tools'}
                aria-controls="activity-panel-tools"
              >
                Tool Logs{toolNodes.length > 0 && <span className="activity-tab-count">{toolNodes.length}</span>}
              </button>
            </div>
          </div>

          <div className="activity-content" ref={containerRef} role="tabpanel" id={`activity-panel-${activeTab}`} aria-label={activeTab === 'agents' ? 'Agent activity' : 'Tool logs'}>
            {visibleNodes.length === 0 ? (
              <div className="activity-empty">
                <div className="activity-empty-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" />
                    <line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" />
                    <line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" />
                    <line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" />
                    <line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                </div>
                <p className="activity-empty-text">No activity yet</p>
                <p className="activity-empty-sub">Agent operations and tool usage will appear here in real-time</p>
              </div>
            ) : (
              <div className="tree-root">
                {visibleNodes.map((node) => (
                  <TreeNode
                    key={node.tool_use_id}
                    node={node}
                    depth={0}
                    onNodeSelect={handleNodeSelect}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <UsageStatsBar stats={usageStats} />
    </div>
  );
};
