import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ActivityNode, isAgentNode, AgentNode, ToolNode, UsageStats } from '../types';
import { AgentCard } from './AgentCard';
import { ToolRow } from './ToolRow';
import { NodeDetail } from './NodeDetail';
import { UsageStatsBar } from './UsageStatsBar';
import { TrustScore } from './TrustScore';
import { useTrustScore } from '../hooks/useTrustScore';
import './ActivityTree.css';

interface ActivityTreeProps {
  tree: ActivityNode[];
  usageStats: UsageStats;
  contextTokens?: number | null;
  sessionId?: string;
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

export const ActivityTree: React.FC<ActivityTreeProps> = ({ tree, usageStats, contextTokens, sessionId }) => {
  const agentsContainerRef = useRef<HTMLDivElement>(null);
  const toolsContainerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<ActivityNode | null>(null);
  const [showTrustPanel, setShowTrustPanel] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const { trustScore, loading: trustLoading, error: trustError } = useTrustScore(sessionId);

  const agentNodes = useMemo(() => tree.filter(isAgentNode), [tree]);
  const toolNodes = useMemo(() => tree.filter((n) => !isAgentNode(n)) as ToolNode[], [tree]);

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
    if (!selectedNode && !showTrustPanel) {
      if (agentsContainerRef.current && agentNodes.length > 0) {
        agentsContainerRef.current.scrollTop = agentsContainerRef.current.scrollHeight;
      }
      if (toolsContainerRef.current && toolNodes.length > 0) {
        toolsContainerRef.current.scrollTop = toolsContainerRef.current.scrollHeight;
      }
    }
  }, [tree, selectedNode, showTrustPanel, agentNodes.length, toolNodes.length]);

  const handleNodeSelect = useCallback((node: ActivityNode) => {
    setSelectedNode(node);
  }, []);

  const handleCloseDetail = () => {
    setSelectedNode(null);
  };

  const handleTrustToggle = () => {
    setShowTrustPanel(!showTrustPanel);
  };

  return (
    <div className="activity-tree">
      {selectedNode ? (
        <NodeDetail node={selectedNode} onClose={handleCloseDetail} />
      ) : showTrustPanel && sessionId ? (
        <>
          <div className="activity-header">
            <button
              className="trust-back-btn"
              onClick={handleTrustToggle}
              aria-label="Back to activity view"
            >
              ← Back
            </button>
          </div>
          <div className="activity-content">
            {trustLoading || trustError || !trustScore ? (
              <div className="activity-empty">
                <div className="activity-empty-pulse" />
                <p className="activity-empty-title">Standby</p>
                <p className="activity-empty-sub">
                  Activity appears here as Claude works
                </p>
              </div>
            ) : (
              <TrustScore
                sessionId={sessionId}
                trustMetrics={trustScore}
                loading={false}
                error={null}
              />
            )}
          </div>
        </>
      ) : (
        <>
          {sessionId && (
            <div className="activity-header">
              <button
                className="trust-toggle-btn"
                onClick={handleTrustToggle}
                aria-label="View trust score"
              >
                Trust Score
              </button>
            </div>
          )}
          <div className="activity-split">
            <div className="activity-panel">
              <div className="activity-panel-header">Agents</div>
              <div className="activity-panel-content" ref={agentsContainerRef}>
                {agentNodes.length === 0 ? (
                  <div className="activity-empty">
                    <div className="activity-empty-pulse" />
                    <p className="activity-empty-title">Standby</p>
                    <p className="activity-empty-sub">
                      Agents appear here as Claude works
                    </p>
                  </div>
                ) : (
                  <div className="tree-root">
                    {agentNodes.map((node) => (
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
            </div>
            <div className="activity-panel">
              <div className="activity-panel-header">Tools</div>
              <div className="activity-panel-content" ref={toolsContainerRef}>
                {toolNodes.length === 0 ? (
                  <div className="activity-empty">
                    <div className="activity-empty-pulse" />
                    <p className="activity-empty-title">Standby</p>
                    <p className="activity-empty-sub">
                      Tools appear here as Claude works
                    </p>
                  </div>
                ) : (
                  <div className="tree-root">
                    {toolNodes.map((node) => (
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
            </div>
          </div>
        </>
      )}
      <UsageStatsBar
        stats={usageStats}
        totalTools={activityStats.totalTools}
        elapsed={activityStats.elapsed}
        errorCount={activityStats.errorCount}
        hasRunning={activityStats.hasRunning}
        contextTokens={contextTokens}
      />
    </div>
  );
};
