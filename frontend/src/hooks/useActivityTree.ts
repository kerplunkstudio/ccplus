import { useReducer, useRef, useEffect, useCallback } from 'react';
import { ActivityNode, AgentNode, ToolNode, ToolEvent, isAgentNode } from '../types';

export type TreeAction =
  | { type: 'AGENT_START'; event: ToolEvent; sequence: number }
  | { type: 'TOOL_START'; event: ToolEvent; sequence: number }
  | { type: 'TOOL_COMPLETE'; event: ToolEvent }
  | { type: 'AGENT_STOP'; event: ToolEvent }
  | { type: 'CLEAR' }
  | { type: 'LOAD_HISTORY'; events: ToolEvent[] }
  | { type: 'MARK_ALL_STOPPED' }
  | { type: 'TOOL_PROGRESS'; toolUseId: string; elapsedSeconds: number }
  | { type: 'SET_TREE'; tree: ActivityNode[] };

export function findAndInsert(nodes: ActivityNode[], parentId: string, child: ActivityNode): ActivityNode[] {
  return nodes.map((node) => {
    if (isAgentNode(node) && node.tool_use_id === parentId) {
      return { ...node, children: [...node.children, child] };
    }
    if (isAgentNode(node)) {
      return { ...node, children: findAndInsert(node.children, parentId, child) };
    }
    return node;
  });
}

export function findAndUpdate(
  nodes: ActivityNode[],
  toolUseId: string,
  updater: (node: ActivityNode) => ActivityNode
): ActivityNode[] {
  return nodes.map((node) => {
    if (node.tool_use_id === toolUseId) {
      return updater(node);
    }
    if (isAgentNode(node)) {
      return { ...node, children: findAndUpdate(node.children, toolUseId, updater) };
    }
    return node;
  });
}

export function markRunningAsStopped(nodes: ActivityNode[]): ActivityNode[] {
  return nodes.map((node) => {
    const updated = node.status === 'running' ? { ...node, status: 'stopped' as const } : node;
    if (isAgentNode(updated)) {
      return { ...updated, children: markRunningAsStopped(updated.children) };
    }
    return updated;
  });
}

export function treeReducer(state: ActivityNode[], action: TreeAction): ActivityNode[] {
  switch (action.type) {
    case 'AGENT_START': {
      const newAgent: AgentNode = {
        tool_use_id: action.event.tool_use_id,
        agent_type: action.event.agent_type || 'agent',
        tool_name: action.event.tool_name,
        description: action.event.description,
        timestamp: action.event.timestamp,
        children: [],
        status: 'running',
      };
      if (action.event.parent_agent_id) {
        return findAndInsert(state, action.event.parent_agent_id, newAgent);
      }
      return [...state, newAgent];
    }

    case 'TOOL_START': {
      const newTool: ToolNode = {
        tool_use_id: action.event.tool_use_id,
        tool_name: action.event.tool_name,
        timestamp: action.event.timestamp,
        status: 'running',
        parameters: action.event.parameters,
        parent_agent_id: action.event.parent_agent_id,
      };
      if (action.event.parent_agent_id) {
        return findAndInsert(state, action.event.parent_agent_id, newTool);
      }
      return [...state, newTool];
    }

    case 'TOOL_COMPLETE': {
      const isWorkerRestart = action.event.error === 'Worker restarted';
      return findAndUpdate(state, action.event.tool_use_id, (node) => ({
        ...node,
        status: (action.event.success === false && !isWorkerRestart) ? 'failed' : 'completed',
        duration_ms: action.event.duration_ms,
        error: isWorkerRestart ? undefined : action.event.error,
      }));
    }

    case 'AGENT_STOP': {
      const isWorkerRestart = action.event.error === 'Worker restarted';
      return findAndUpdate(state, action.event.tool_use_id, (node) => ({
        ...node,
        status: (action.event.error && !isWorkerRestart) ? 'failed' : 'completed',
        duration_ms: action.event.duration_ms,
        error: isWorkerRestart ? undefined : action.event.error,
        transcript_path: action.event.transcript_path,
        summary: action.event.summary,
      }));
    }

    case 'LOAD_HISTORY': {
      let newNodes: ActivityNode[] = [];
      let sequence = 0;

      for (const event of action.events) {
        if (event.type === 'agent_start') {
          const node: AgentNode = {
            tool_use_id: event.tool_use_id,
            agent_type: event.agent_type || 'agent',
            tool_name: event.tool_name,
            description: event.description,
            timestamp: event.timestamp,
            children: [],
            status: 'running',
            sequence: ++sequence,
          };
          if (event.parent_agent_id) {
            newNodes = findAndInsert(newNodes, event.parent_agent_id, node);
          } else {
            newNodes.push(node);
          }
        } else if (event.type === 'tool_start') {
          const node: ToolNode = {
            tool_use_id: event.tool_use_id,
            tool_name: event.tool_name,
            timestamp: event.timestamp,
            status: 'running',
            parameters: event.parameters,
            parent_agent_id: event.parent_agent_id,
            sequence: ++sequence,
          };
          if (event.parent_agent_id) {
            newNodes = findAndInsert(newNodes, event.parent_agent_id, node);
          } else {
            newNodes.push(node);
          }
        } else if (event.type === 'tool_complete' || event.type === 'agent_stop') {
          const isWorkerRestart = event.error === 'Worker restarted';
          newNodes = findAndUpdate(newNodes, event.tool_use_id, (node) => ({
            ...node,
            status: (event.success === false && !isWorkerRestart) ? 'failed' : 'completed',
            duration_ms: event.duration_ms,
            error: isWorkerRestart ? undefined : event.error,
            transcript_path: event.type === 'agent_stop' ? event.transcript_path : undefined,
            summary: event.type === 'agent_stop' ? event.summary : undefined,
          }));
        }
      }
      return newNodes;
    }

    case 'CLEAR':
      return [];

    case 'MARK_ALL_STOPPED':
      return markRunningAsStopped(state);

    case 'TOOL_PROGRESS': {
      return findAndUpdate(state, action.toolUseId, (node) => ({
        ...node,
        elapsed_seconds: action.elapsedSeconds,
      }));
    }

    case 'SET_TREE':
      return action.tree;

    default:
      return state;
  }
}

// Helper to check if there are any running agents in the activity tree
export function checkHasRunningAgents(nodes: ActivityNode[]): boolean {
  for (const node of nodes) {
    if (node.status === 'running') {
      return true;
    }
    if (isAgentNode(node) && checkHasRunningAgents(node.children)) {
      return true;
    }
  }
  return false;
}

export function useActivityTree() {
  const [activityTree, dispatchTree] = useReducer(treeReducer, []);
  const activityTreeRef = useRef<ActivityNode[]>([]);

  // Keep ref in sync with state
  useEffect(() => {
    activityTreeRef.current = activityTree;
  }, [activityTree]);

  const hasRunningAgents = useCallback((nodes: ActivityNode[]): boolean => {
    return checkHasRunningAgents(nodes);
  }, []);

  return {
    activityTree,
    activityTreeRef,
    dispatchTree,
    hasRunningAgents,
  };
}
