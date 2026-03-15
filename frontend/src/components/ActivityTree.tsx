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

const countTools = (nodes: ActivityNode[]): number => {
  let count = 0;
  for (const node of nodes) {
    if (!isAgentNode(node)) {
      count += 1;
    } else {
      count += countTools((node as AgentNode).children);
    }
  }
  return count;
};

const findEarliestTimestamp = (nodes: ActivityNode[]): Date | null => {
  let earliest: Date | null = null;
  for (const node of nodes) {
    const nodeTime = new Date(node.timestamp);
    if (!earliest || nodeTime < earliest) {
      earliest = nodeTime;
    }
    if (isAgentNode(node)) {
      const childEarliest = findEarliestTimestamp((node as AgentNode).children);
      if (childEarliest && (!earliest || childEarliest < earliest)) {
        earliest = childEarliest;
      }
    }
  }
  return earliest;
};

const findLatestCompletedTimestamp = (nodes: ActivityNode[]): Date | null => {
  let latest: Date | null = null;
  for (const node of nodes) {
    if (node.status === 'completed' || node.status === 'failed' || node.status === 'stopped') {
      const nodeTime = new Date(node.timestamp);
      if (node.duration_ms !== undefined) {
        nodeTime.setTime(nodeTime.getTime() + node.duration_ms);
      }
      if (!latest || nodeTime > latest) {
        latest = nodeTime;
      }
    }
    if (isAgentNode(node)) {
      const childLatest = findLatestCompletedTimestamp((node as AgentNode).children);
      if (childLatest && (!latest || childLatest > latest)) {
        latest = childLatest;
      }
    }
  }
  return latest;
};

const countErrors = (nodes: ActivityNode[]): number => {
  let count = 0;
  for (const node of nodes) {
    if (node.status === 'failed') {
      count += 1;
    }
    if (isAgentNode(node)) {
      count += countErrors((node as AgentNode).children);
    }
  }
  return count;
};

const hasRunningNodes = (nodes: ActivityNode[]): boolean => {
  for (const node of nodes) {
    if (node.status === 'running') {
      return true;
    }
    if (isAgentNode(node) && hasRunningNodes((node as AgentNode).children)) {
      return true;
    }
  }
  return false;
};

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
};

export const ActivityTree: React.FC<ActivityTreeProps> = ({ tree, usageStats }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const userOverrideRef = useRef(false);
  const [selectedNode, setSelectedNode] = useState<ActivityNode | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'tools'>('agents');
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const agentNodes = useMemo(() => tree.filter(isAgentNode), [tree]);
  const toolNodes = useMemo(() => tree.filter((n) => !isAgentNode(n)) as ToolNode[], [tree]);
  const visibleNodes = activeTab === 'agents' ? agentNodes : toolNodes;

  const activityStats = useMemo(() => {
    const totalTools = countTools(tree);
    const errorCount = countErrors(tree);
    const isRunning = hasRunningNodes(tree);
    const earliestTime = findEarliestTimestamp(tree);
    const latestCompletedTime = findLatestCompletedTimestamp(tree);

    let elapsedMs = 0;
    if (earliestTime) {
      const endTime = isRunning ? currentTime : (latestCompletedTime?.getTime() || currentTime);
      elapsedMs = endTime - earliestTime.getTime();
    }

    return {
      totalTools,
      elapsed: formatElapsed(elapsedMs),
      errorCount,
      hasRunning: isRunning,
    };
  }, [tree, currentTime]);

  useEffect(() => {
    if (!activityStats.hasRunning) return;

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [activityStats.hasRunning]);

  useEffect(() => {
    if (tree.length === 0) {
      userOverrideRef.current = false;
      setActiveTab('agents');
      return;
    }

    if (userOverrideRef.current) return;

    const lastNode = tree[tree.length - 1];
    setActiveTab(isAgentNode(lastNode) ? 'agents' : 'tools');
  }, [tree]);

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
      <UsageStatsBar
        stats={usageStats}
        totalTools={activityStats.totalTools}
        elapsed={activityStats.elapsed}
        errorCount={activityStats.errorCount}
        hasRunning={activityStats.hasRunning}
      />
    </div>
  );
};
