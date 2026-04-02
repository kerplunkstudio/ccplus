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

// Internal compound state: tree + O(1) path index
interface TreeState {
  tree: ActivityNode[];
  index: Map<string, number[]>; // tool_use_id → path as array of child indices
}

export const ORCHESTRATOR_ID = '__orchestrator__';

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

// Insert a node at the chronologically correct position by timestamp
export function insertNodeChronologically(nodes: ActivityNode[], newNode: ActivityNode): ActivityNode[] {
  const idx = nodes.findIndex(n => new Date(n.timestamp) > new Date(newNode.timestamp));
  if (idx === -1) return [...nodes, newNode];
  return [...nodes.slice(0, idx), newNode, ...nodes.slice(idx)];
}

// Derive Orchestrator status from its children (call after any child status change)
export function syncOrchestratorStatus(nodes: ActivityNode[]): ActivityNode[] {
  const orchIdx = nodes.findIndex(n => isAgentNode(n) && n.tool_use_id === ORCHESTRATOR_ID);
  if (orchIdx === -1) return nodes;

  const orch = nodes[orchIdx] as AgentNode;
  const children = orch.children;

  let newStatus: AgentNode['status'];
  if (children.length === 0 || children.some(c => c.status === 'running')) {
    newStatus = 'running';
  } else if (children.some(c => c.status === 'failed')) {
    newStatus = 'failed';
  } else if (children.some(c => c.status === 'stopped')) {
    newStatus = 'stopped';
  } else {
    newStatus = 'completed';
  }

  if (newStatus === orch.status) return nodes;
  return nodes.map((n, i) => i === orchIdx ? { ...orch, status: newStatus } : n);
}

// Group orphan tool nodes (root-level ToolNodes) under a virtual Orchestrator AgentNode.
// Returns the nodes unchanged if there are no orphan tools.
export function groupOrphanTools(nodes: ActivityNode[]): ActivityNode[] {
  const orphanTools = nodes.filter(n => !isAgentNode(n)) as ToolNode[];
  if (orphanTools.length === 0) return nodes;
  // Guard: if Orchestrator already exists, don't create a duplicate
  if (nodes.some(n => isAgentNode(n) && n.tool_use_id === ORCHESTRATOR_ID)) return nodes;

  const agentNodes = nodes.filter(n => isAgentNode(n));

  // Derive Orchestrator status from children
  let orchStatus: AgentNode['status'] = 'running';
  if (orphanTools.every(t => t.status !== 'running')) {
    if (orphanTools.some(t => t.status === 'failed')) orchStatus = 'failed';
    else if (orphanTools.some(t => t.status === 'stopped')) orchStatus = 'stopped';
    else orchStatus = 'completed';
  }

  const orchestratorNode: AgentNode = {
    tool_use_id: ORCHESTRATOR_ID,
    agent_type: 'orchestrator',
    tool_name: 'Agent',
    description: 'Orchestrator',
    timestamp: orphanTools[0].timestamp, // first orphan tool's timestamp
    children: orphanTools,
    status: orchStatus,
  };

  return insertNodeChronologically(agentNodes, orchestratorNode);
}

// ---------------------------------------------------------------------------
// O(1) index helpers
// ---------------------------------------------------------------------------

// Build a flat path index from a tree. Walks the full tree once.
function buildIndex(tree: ActivityNode[]): Map<string, number[]> {
  const index = new Map<string, number[]>();

  function walk(nodes: ActivityNode[], path: number[]) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nodePath = [...path, i];
      index.set(node.tool_use_id, nodePath);
      if (isAgentNode(node)) {
        walk(node.children, nodePath);
      }
    }
  }

  walk(tree, []);
  return index;
}

// Update a node at path immutably, cloning only the spine from root to target.
function updateNodeByPath(
  tree: ActivityNode[],
  path: number[],
  updater: (node: ActivityNode) => ActivityNode
): ActivityNode[] {
  if (path.length === 0) return tree;

  const newTree = [...tree];
  if (path.length === 1) {
    newTree[path[0]] = updater(newTree[path[0]]);
    return newTree;
  }

  // Rebuild only the spine from root to target node
  const parentNode = newTree[path[0]] as AgentNode;
  newTree[path[0]] = {
    ...parentNode,
    children: updateNodeByPath(parentNode.children, path.slice(1), updater),
  };
  return newTree;
}

// Insert a child under the node at parentPath. Returns new tree and the child's path.
function insertChildByPath(
  tree: ActivityNode[],
  parentPath: number[],
  child: ActivityNode
): { tree: ActivityNode[]; childPath: number[] } {
  if (parentPath.length === 0) {
    // Insert at root level
    return { tree: [...tree, child], childPath: [tree.length] };
  }

  // Clone spine down to the parent, append child to parent's children array
  const newTree = [...tree];
  const rootIdx = parentPath[0];

  if (parentPath.length === 1) {
    const parentNode = newTree[rootIdx] as AgentNode;
    const childPath = [...parentPath, parentNode.children.length];
    newTree[rootIdx] = {
      ...parentNode,
      children: [...parentNode.children, child],
    };
    return { tree: newTree, childPath };
  }

  // Recurse into spine
  const rootNode = newTree[rootIdx] as AgentNode;
  const inner = insertChildByPath(rootNode.children, parentPath.slice(1), child);
  newTree[rootIdx] = { ...rootNode, children: inner.tree };
  return { tree: newTree, childPath: [rootIdx, ...inner.childPath] };
}

// ---------------------------------------------------------------------------
// Internal reducer using TreeState
// ---------------------------------------------------------------------------

const INITIAL_TREE_STATE: TreeState = { tree: [], index: new Map() };

function internalReducer(state: TreeState, action: TreeAction): TreeState {
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
        sequence: action.sequence,
      };

      if (action.event.parent_agent_id) {
        const parentPath = state.index.get(action.event.parent_agent_id);
        if (parentPath !== undefined) {
          const { tree: newTree, childPath } = insertChildByPath(state.tree, parentPath, newAgent);
          const newIndex = new Map(state.index);
          newIndex.set(newAgent.tool_use_id, childPath);
          return { tree: newTree, index: newIndex };
        }
        // Fallback: parent not in index (should not happen in practice)
        const newTree = findAndInsert(state.tree, action.event.parent_agent_id, newAgent);
        return { tree: newTree, index: buildIndex(newTree) };
      }

      const newTree = [...state.tree, newAgent];
      const newIndex = new Map(state.index);
      newIndex.set(newAgent.tool_use_id, [state.tree.length]);
      return { tree: newTree, index: newIndex };
    }

    case 'TOOL_START': {
      const newTool: ToolNode = {
        tool_use_id: action.event.tool_use_id,
        tool_name: action.event.tool_name,
        timestamp: action.event.timestamp,
        status: 'running',
        parameters: action.event.parameters,
        parent_agent_id: action.event.parent_agent_id,
        sequence: action.sequence,
      };

      if (action.event.parent_agent_id) {
        const parentPath = state.index.get(action.event.parent_agent_id);
        if (parentPath !== undefined) {
          const { tree: newTree, childPath } = insertChildByPath(state.tree, parentPath, newTool);
          const newIndex = new Map(state.index);
          newIndex.set(newTool.tool_use_id, childPath);
          return { tree: newTree, index: newIndex };
        }
        // Fallback
        const newTree = findAndInsert(state.tree, action.event.parent_agent_id, newTool);
        return { tree: newTree, index: buildIndex(newTree) };
      }

      // Orphan tool — route to Orchestrator virtual node
      const orchPath = state.index.get(ORCHESTRATOR_ID);
      if (orchPath !== undefined) {
        const { tree: newTree, childPath } = insertChildByPath(state.tree, orchPath, newTool);
        const newIndex = new Map(state.index);
        newIndex.set(newTool.tool_use_id, childPath);
        return { tree: newTree, index: newIndex };
      }

      // Create Orchestrator with this tool as its first child
      const orchestratorNode: AgentNode = {
        tool_use_id: ORCHESTRATOR_ID,
        agent_type: 'orchestrator',
        tool_name: 'Agent',
        description: 'Orchestrator',
        timestamp: action.event.timestamp,
        children: [newTool],
        status: 'running',
      };
      const newTree = insertNodeChronologically(state.tree, orchestratorNode);
      return { tree: newTree, index: buildIndex(newTree) };
    }

    case 'TOOL_COMPLETE': {
      const isWorkerRestart = action.event.error === 'Worker restarted';
      const path = state.index.get(action.event.tool_use_id);

      let newTree: ActivityNode[];
      if (path !== undefined) {
        newTree = updateNodeByPath(state.tree, path, (node) => ({
          ...node,
          status: (action.event.success === false && !isWorkerRestart) ? 'failed' : 'completed',
          duration_ms: action.event.duration_ms,
          error: isWorkerRestart ? undefined : action.event.error,
        }));
      } else {
        // Fallback
        newTree = findAndUpdate(state.tree, action.event.tool_use_id, (node) => ({
          ...node,
          status: (action.event.success === false && !isWorkerRestart) ? 'failed' : 'completed',
          duration_ms: action.event.duration_ms,
          error: isWorkerRestart ? undefined : action.event.error,
        }));
      }
      // Sync orchestrator status (root-level O(n_root) scan — cheap)
      newTree = syncOrchestratorStatus(newTree);
      // Index paths don't change on update, reuse existing index
      return { tree: newTree, index: state.index };
    }

    case 'AGENT_STOP': {
      const isWorkerRestart = action.event.error === 'Worker restarted';
      const path = state.index.get(action.event.tool_use_id);

      let newTree: ActivityNode[];
      if (path !== undefined) {
        newTree = updateNodeByPath(state.tree, path, (node) => ({
          ...node,
          status: (action.event.error && !isWorkerRestart) ? 'failed' : 'completed',
          duration_ms: action.event.duration_ms,
          error: isWorkerRestart ? undefined : action.event.error,
          transcript_path: action.event.transcript_path,
          summary: action.event.summary,
        }));
      } else {
        // Fallback
        newTree = findAndUpdate(state.tree, action.event.tool_use_id, (node) => ({
          ...node,
          status: (action.event.error && !isWorkerRestart) ? 'failed' : 'completed',
          duration_ms: action.event.duration_ms,
          error: isWorkerRestart ? undefined : action.event.error,
          transcript_path: action.event.transcript_path,
          summary: action.event.summary,
        }));
      }
      return { tree: newTree, index: state.index };
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
      const tree = groupOrphanTools(newNodes);
      return { tree, index: buildIndex(tree) };
    }

    case 'CLEAR':
      return INITIAL_TREE_STATE;

    case 'MARK_ALL_STOPPED': {
      const tree = markRunningAsStopped(state.tree);
      // Rebuild index since markRunningAsStopped creates new node objects (paths unchanged,
      // but safer to rebuild since it touches the whole tree anyway)
      return { tree, index: buildIndex(tree) };
    }

    case 'TOOL_PROGRESS': {
      const path = state.index.get(action.toolUseId);
      if (path !== undefined) {
        const newTree = updateNodeByPath(state.tree, path, (node) => ({
          ...node,
          elapsed_seconds: action.elapsedSeconds,
        }));
        return { tree: newTree, index: state.index };
      }
      // Fallback
      const newTree = findAndUpdate(state.tree, action.toolUseId, (node) => ({
        ...node,
        elapsed_seconds: action.elapsedSeconds,
      }));
      return { tree: newTree, index: state.index };
    }

    case 'SET_TREE': {
      const tree = action.tree;
      return { tree, index: buildIndex(tree) };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Public treeReducer (backward-compatible: accepts and returns ActivityNode[])
// ---------------------------------------------------------------------------

export function treeReducer(state: ActivityNode[], action: TreeAction): ActivityNode[] {
  const treeState: TreeState = { tree: state, index: buildIndex(state) };
  return internalReducer(treeState, action).tree;
}

// ---------------------------------------------------------------------------
// Remaining public helpers
// ---------------------------------------------------------------------------

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
  const [state, dispatchInternal] = useReducer(internalReducer, INITIAL_TREE_STATE);
  const activityTreeRef = useRef<ActivityNode[]>([]);

  // Keep ref in sync with state
  useEffect(() => {
    activityTreeRef.current = state.tree;
  }, [state.tree]);

  const hasRunningAgents = useCallback((nodes: ActivityNode[]): boolean => {
    return checkHasRunningAgents(nodes);
  }, []);

  return {
    activityTree: state.tree,
    activityTreeRef,
    dispatchTree: dispatchInternal,
    hasRunningAgents,
  };
}
