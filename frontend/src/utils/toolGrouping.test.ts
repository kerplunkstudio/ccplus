import { groupConsecutiveTools, ToolGroup } from './toolGrouping';
import { ToolNode } from '../types';

const createToolNode = (tool_name: string, status: ToolNode['status'] = 'completed'): ToolNode => ({
  tool_use_id: `${tool_name}-${Math.random()}`,
  tool_name,
  timestamp: new Date().toISOString(),
  status,
  parent_agent_id: null,
});

describe('groupConsecutiveTools', () => {
  it('returns empty array for empty input', () => {
    expect(groupConsecutiveTools([])).toEqual([]);
  });

  it('does not group single tool', () => {
    const nodes = [createToolNode('Read')];
    expect(groupConsecutiveTools(nodes)).toEqual(nodes);
  });

  it('does not group two consecutive tools (below minGroup)', () => {
    const nodes = [createToolNode('Read'), createToolNode('Read')];
    expect(groupConsecutiveTools(nodes)).toEqual(nodes);
  });

  it('groups three consecutive tools with same name', () => {
    const nodes = [
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
    ];
    const result = groupConsecutiveTools(nodes);
    expect(result.length).toBe(1);
    const group = result[0] as ToolGroup;
    expect(group.type).toBe('group');
    expect(group.tool_name).toBe('Read');
    expect(group.nodes.length).toBe(3);
    expect(group.status).toBe('completed');
  });

  it('groups only consecutive runs, not separated occurrences', () => {
    const nodes = [
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Write'),
      createToolNode('Read'),
      createToolNode('Read'),
    ];
    const result = groupConsecutiveTools(nodes);
    expect(result.length).toBe(4);
    expect((result[0] as ToolGroup).type).toBe('group');
    expect((result[1] as ToolNode).tool_name).toBe('Write');
    expect((result[2] as ToolNode).tool_name).toBe('Read');
    expect((result[3] as ToolNode).tool_name).toBe('Read');
  });

  it('sets status to failed if any node failed', () => {
    const nodes = [
      createToolNode('Read', 'completed'),
      createToolNode('Read', 'failed'),
      createToolNode('Read', 'completed'),
    ];
    const result = groupConsecutiveTools(nodes);
    const group = result[0] as ToolGroup;
    expect(group.status).toBe('failed');
  });

  it('sets status to running if any node running and none failed', () => {
    const nodes = [
      createToolNode('Read', 'completed'),
      createToolNode('Read', 'running'),
      createToolNode('Read', 'completed'),
    ];
    const result = groupConsecutiveTools(nodes);
    const group = result[0] as ToolGroup;
    expect(group.status).toBe('running');
  });

  it('sets status to stopped if any node stopped and none failed/running', () => {
    const nodes = [
      createToolNode('Read', 'completed'),
      createToolNode('Read', 'stopped'),
      createToolNode('Read', 'completed'),
    ];
    const result = groupConsecutiveTools(nodes);
    const group = result[0] as ToolGroup;
    expect(group.status).toBe('stopped');
  });

  it('sets status to completed if all nodes completed', () => {
    const nodes = [
      createToolNode('Read', 'completed'),
      createToolNode('Read', 'completed'),
      createToolNode('Read', 'completed'),
    ];
    const result = groupConsecutiveTools(nodes);
    const group = result[0] as ToolGroup;
    expect(group.status).toBe('completed');
  });

  it('respects custom minGroup threshold', () => {
    const nodes = [
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
    ];
    const result = groupConsecutiveTools(nodes, 5);
    expect(result.length).toBe(1);
    expect((result[0] as ToolGroup).nodes.length).toBe(5);
  });

  it('does not group if run is below custom minGroup threshold', () => {
    const nodes = [
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
    ];
    const result = groupConsecutiveTools(nodes, 4);
    expect(result.length).toBe(3);
  });

  it('handles mixed tool types correctly', () => {
    const nodes = [
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Write'),
      createToolNode('Write'),
      createToolNode('Write'),
      createToolNode('Bash'),
    ];
    const result = groupConsecutiveTools(nodes);
    expect(result.length).toBe(3);
    expect((result[0] as ToolGroup).tool_name).toBe('Read');
    expect((result[1] as ToolGroup).tool_name).toBe('Write');
    expect((result[2] as ToolNode).tool_name).toBe('Bash');
  });

  it('uses first node tool_use_id as group id', () => {
    const nodes = [
      createToolNode('Read'),
      createToolNode('Read'),
      createToolNode('Read'),
    ];
    const result = groupConsecutiveTools(nodes);
    const group = result[0] as ToolGroup;
    expect(group.tool_use_id).toBe(nodes[0].tool_use_id);
  });
});
