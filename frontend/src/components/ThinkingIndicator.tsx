import React from 'react';
import { ActivityNode, SignalState, isAgentNode } from '../types';
import './ThinkingIndicator.css';

const countRunningAgents = (nodes: ActivityNode[]): number => {
  let count = 0;
  for (const node of nodes) {
    if (isAgentNode(node)) {
      if (node.status === 'running') {
        count++;
      }
      count += countRunningAgents(node.children);
    }
  }
  return count;
};

interface ThinkingIndicatorProps {
  activityTree: ActivityNode[];
  signals?: SignalState;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  activityTree,
  signals,
}) => {
  const statusText = signals?.status?.detail ||
    (signals?.status?.phase ? signals.status.phase.charAt(0).toUpperCase() + signals.status.phase.slice(1) : (() => {
      const runningAgents = countRunningAgents(activityTree);
      if (runningAgents === 0) return 'Thinking...';
      if (runningAgents === 1) return 'Running 1 agent...';
      return `Running ${runningAgents} agents...`;
    })());

  return (
    <div className="thinking-indicator">
      <div className="thinking-content">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="thinking-text" role="status">
          {statusText}
        </span>
      </div>
    </div>
  );
};
