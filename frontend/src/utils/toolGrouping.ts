import { ToolNode } from '../types';

export interface ToolGroup {
  type: 'group';
  tool_use_id: string;
  tool_name: string;
  nodes: ToolNode[];
  status: 'running' | 'completed' | 'failed' | 'stopped';
}

function worstStatus(nodes: ToolNode[]): ToolGroup['status'] {
  if (nodes.some(n => n.status === 'failed')) return 'failed';
  if (nodes.some(n => n.status === 'running')) return 'running';
  if (nodes.some(n => n.status === 'stopped')) return 'stopped';
  return 'completed';
}

export function groupConsecutiveTools(
  nodes: ToolNode[],
  minGroup = 3
): (ToolNode | ToolGroup)[] {
  const result: (ToolNode | ToolGroup)[] = [];
  let i = 0;
  while (i < nodes.length) {
    let j = i + 1;
    while (j < nodes.length && nodes[j].tool_name === nodes[i].tool_name) j++;
    const run = nodes.slice(i, j);
    if (run.length >= minGroup) {
      result.push({
        type: 'group',
        tool_use_id: run[0].tool_use_id,
        tool_name: nodes[i].tool_name,
        nodes: run,
        status: worstStatus(run),
      });
    } else {
      result.push(...run);
    }
    i = j;
  }
  return result;
}
