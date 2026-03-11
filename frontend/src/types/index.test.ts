import { isAgentNode, AgentNode, ToolNode, ActivityNode } from './index';

describe('types', () => {
  describe('isAgentNode', () => {
    it('returns true for AgentNode (has children)', () => {
      const agent: AgentNode = {
        tool_use_id: 'agent_1',
        agent_type: 'code_agent',
        tool_name: 'dispatch_agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [],
        status: 'running',
      };
      expect(isAgentNode(agent)).toBe(true);
    });

    it('returns false for ToolNode (no children)', () => {
      const tool: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'completed',
        parent_agent_id: null,
      };
      expect(isAgentNode(tool)).toBe(false);
    });

    it('returns true for AgentNode with children populated', () => {
      const child: ToolNode = {
        tool_use_id: 'tool_2',
        tool_name: 'Write',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: 'agent_2',
      };
      const agent: AgentNode = {
        tool_use_id: 'agent_2',
        agent_type: 'research',
        tool_name: 'dispatch_agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [child],
        status: 'running',
      };
      expect(isAgentNode(agent)).toBe(true);
    });
  });
});
