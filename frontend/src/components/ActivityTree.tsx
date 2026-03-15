import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

const TreeNode: React.FC<TreeNodeProps> = React.memo(({ node, depth, onNodeSelect }) => {
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
});

export const ActivityTree: React.FC<ActivityTreeProps> = ({ tree, usageStats }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const userOverrideRef = useRef(false);
  const [selectedNode, setSelectedNode] = useState<ActivityNode | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'tools'>('agents');

  const agentNodes = useMemo(() => tree.filter(isAgentNode), [tree]);
  const toolNodes = useMemo(() => tree.filter((n) => !isAgentNode(n)) as ToolNode[], [tree]);
  const visibleNodes = activeTab === 'agents' ? agentNodes : toolNodes;

  const hasRunningAgent = useCallback((nodes: ActivityNode[]): boolean => {
    for (const node of nodes) {
      if (node.status === 'running') return true;
      if (isAgentNode(node) && hasRunningAgent((node as AgentNode).children)) return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (tree.length === 0) {
      userOverrideRef.current = false;
      setActiveTab('agents');
      return;
    }

    if (userOverrideRef.current) return;

    if (hasRunningAgent(tree)) {
      setActiveTab('agents');
    } else if (toolNodes.length > 0) {
      setActiveTab('tools');
    }
  }, [tree, toolNodes.length, hasRunningAgent]);

  useEffect(() => {
    if (containerRef.current && !selectedNode) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [tree, selectedNode, activeTab]);

  const handleNodeSelect = useCallback((node: ActivityNode) => {
    setSelectedNode(node);
  }, []);

  const handleCloseDetail = () => {
    setSelectedNode(null);
  };

  const handleTabClick = (tab: 'agents' | 'tools') => {
    userOverrideRef.current = true;
    setActiveTab(tab);
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
                onClick={() => handleTabClick('agents')}
                role="tab"
                aria-selected={activeTab === 'agents'}
                aria-controls="activity-panel-agents"
              >
                Agents{agentNodes.length > 0 && <span className="activity-tab-count">{agentNodes.length}</span>}
              </button>
              <button
                className={`activity-tab ${activeTab === 'tools' ? 'activity-tab-active' : ''}`}
                onClick={() => handleTabClick('tools')}
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
              <p className="activity-empty-hint">Activity appears here</p>
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
