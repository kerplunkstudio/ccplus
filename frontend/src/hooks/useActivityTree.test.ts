import { renderHook, act } from '@testing-library/react';
import {
  findAndInsert,
  findAndUpdate,
  markRunningAsStopped,
  treeReducer,
  checkHasRunningAgents,
  useActivityTree,
  TreeAction,
} from './useActivityTree';
import { ActivityNode, AgentNode, ToolNode, ToolEvent } from '../types';

describe('useActivityTree', () => {
  describe('findAndInsert', () => {
    it('inserts child under parent agent (root level)', () => {
      const parent: AgentNode = {
        tool_use_id: 'agent_1',
        agent_type: 'code_agent',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [],
        status: 'running',
      };

      const child: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: 'agent_1',
      };

      const result = findAndInsert([parent], 'agent_1', child);

      expect(result).toHaveLength(1);
      expect(result[0]).not.toBe(parent); // immutability
      expect((result[0] as AgentNode).children).toHaveLength(1);
      expect((result[0] as AgentNode).children[0]).toBe(child);
    });

    it('inserts child under nested agent (3 levels deep)', () => {
      const grandchild: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Write',
        timestamp: '2025-01-01T00:00:03Z',
        status: 'running',
        parent_agent_id: 'agent_3',
      };

      const childAgent: AgentNode = {
        tool_use_id: 'agent_3',
        agent_type: 'reviewer',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:02Z',
        children: [],
        status: 'running',
      };

      const parentAgent: AgentNode = {
        tool_use_id: 'agent_2',
        agent_type: 'planner',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:01Z',
        children: [childAgent],
        status: 'running',
      };

      const rootAgent: AgentNode = {
        tool_use_id: 'agent_1',
        agent_type: 'orchestrator',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [parentAgent],
        status: 'running',
      };

      const result = findAndInsert([rootAgent], 'agent_3', grandchild);

      expect(result[0]).not.toBe(rootAgent); // immutability at root
      const level1 = (result[0] as AgentNode).children[0] as AgentNode;
      expect(level1).not.toBe(parentAgent); // immutability at level 1
      const level2 = level1.children[0] as AgentNode;
      expect(level2).not.toBe(childAgent); // immutability at level 2
      expect(level2.children).toHaveLength(1);
      expect(level2.children[0]).toBe(grandchild);
    });

    it('returns unchanged tree if parent not found', () => {
      const agent: AgentNode = {
        tool_use_id: 'agent_1',
        agent_type: 'code_agent',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [],
        status: 'running',
      };

      const child: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: 'nonexistent',
      };

      const result = findAndInsert([agent], 'nonexistent', child);

      expect(result).toHaveLength(1);
      expect((result[0] as AgentNode).children).toHaveLength(0);
    });

    it('handles empty tree', () => {
      const child: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: 'agent_1',
      };

      const result = findAndInsert([], 'agent_1', child);

      expect(result).toEqual([]);
    });

    it('only inserts under agent nodes, not tool nodes', () => {
      const tool: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'completed',
        parent_agent_id: null,
      };

      const newChild: ToolNode = {
        tool_use_id: 'tool_2',
        tool_name: 'Write',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: 'tool_1',
      };

      const result = findAndInsert([tool], 'tool_1', newChild);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(tool); // unchanged
    });
  });

  describe('findAndUpdate', () => {
    it('updates root-level node', () => {
      const node: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'running',
        parent_agent_id: null,
      };

      const result = findAndUpdate([node], 'tool_1', (n) => ({
        ...n,
        status: 'completed',
        duration_ms: 1234,
      }));

      expect(result).toHaveLength(1);
      expect(result[0]).not.toBe(node); // immutability
      expect(result[0].status).toBe('completed');
      expect(result[0].duration_ms).toBe(1234);
    });

    it('updates nested node (3 levels deep)', () => {
      const targetTool: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Write',
        timestamp: '2025-01-01T00:00:03Z',
        status: 'running',
        parent_agent_id: 'agent_3',
      };

      const childAgent: AgentNode = {
        tool_use_id: 'agent_3',
        agent_type: 'reviewer',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:02Z',
        children: [targetTool],
        status: 'running',
      };

      const parentAgent: AgentNode = {
        tool_use_id: 'agent_2',
        agent_type: 'planner',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:01Z',
        children: [childAgent],
        status: 'running',
      };

      const rootAgent: AgentNode = {
        tool_use_id: 'agent_1',
        agent_type: 'orchestrator',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [parentAgent],
        status: 'running',
      };

      const result = findAndUpdate([rootAgent], 'tool_1', (n) => ({
        ...n,
        status: 'completed',
        duration_ms: 5678,
      }));

      const level1 = (result[0] as AgentNode).children[0] as AgentNode;
      const level2 = level1.children[0] as AgentNode;
      const updatedTool = level2.children[0] as ToolNode;

      expect(updatedTool.status).toBe('completed');
      expect(updatedTool.duration_ms).toBe(5678);
      expect(updatedTool).not.toBe(targetTool); // immutability
    });

    it('returns unchanged tree if node not found', () => {
      const node: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'running',
        parent_agent_id: null,
      };

      const result = findAndUpdate([node], 'nonexistent', (n) => ({
        ...n,
        status: 'failed',
      }));

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(node); // unchanged
    });

    it('handles empty tree', () => {
      const result = findAndUpdate([], 'tool_1', (n) => ({
        ...n,
        status: 'completed',
      }));

      expect(result).toEqual([]);
    });

    it('applies updater function correctly', () => {
      const node: AgentNode = {
        tool_use_id: 'agent_1',
        agent_type: 'code_agent',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [],
        status: 'running',
      };

      const result = findAndUpdate([node], 'agent_1', (n) => ({
        ...n,
        status: 'failed',
        error: 'Test error',
        duration_ms: 999,
      }));

      expect(result[0].status).toBe('failed');
      expect((result[0] as AgentNode).error).toBe('Test error');
      expect(result[0].duration_ms).toBe(999);
    });
  });

  describe('markRunningAsStopped', () => {
    it('marks running nodes as stopped', () => {
      const runningTool: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'running',
        parent_agent_id: null,
      };

      const result = markRunningAsStopped([runningTool]);

      expect(result[0].status).toBe('stopped');
      expect(result[0]).not.toBe(runningTool); // immutability
    });

    it('leaves completed nodes unchanged', () => {
      const completedTool: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'completed',
        duration_ms: 100,
        parent_agent_id: null,
      };

      const result = markRunningAsStopped([completedTool]);

      expect(result[0].status).toBe('completed');
      expect(result[0]).toBe(completedTool); // no change
    });

    it('leaves failed nodes unchanged', () => {
      const failedTool: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'failed',
        error: 'Test error',
        parent_agent_id: null,
      };

      const result = markRunningAsStopped([failedTool]);

      expect(result[0].status).toBe('failed');
      expect(result[0]).toBe(failedTool); // no change
    });

    it('marks nested running nodes as stopped', () => {
      const runningChild: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Write',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: 'agent_1',
      };

      const runningAgent: AgentNode = {
        tool_use_id: 'agent_1',
        agent_type: 'code_agent',
        tool_name: 'Agent',
        timestamp: '2025-01-01T00:00:00Z',
        children: [runningChild],
        status: 'running',
      };

      const result = markRunningAsStopped([runningAgent]);

      expect(result[0].status).toBe('stopped');
      expect((result[0] as AgentNode).children[0].status).toBe('stopped');
      expect(result[0]).not.toBe(runningAgent); // immutability at root
      expect((result[0] as AgentNode).children[0]).not.toBe(runningChild); // immutability at child
    });

    it('handles mixed statuses correctly', () => {
      const completed: ToolNode = {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'completed',
        parent_agent_id: null,
      };

      const running: ToolNode = {
        tool_use_id: 'tool_2',
        tool_name: 'Write',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: null,
      };

      const failed: ToolNode = {
        tool_use_id: 'tool_3',
        tool_name: 'Edit',
        timestamp: '2025-01-01T00:00:02Z',
        status: 'failed',
        error: 'Error',
        parent_agent_id: null,
      };

      const result = markRunningAsStopped([completed, running, failed]);

      expect(result[0].status).toBe('completed');
      expect(result[1].status).toBe('stopped');
      expect(result[2].status).toBe('failed');
    });

    it('handles empty tree', () => {
      const result = markRunningAsStopped([]);
      expect(result).toEqual([]);
    });
  });

  describe('treeReducer', () => {
    describe('AGENT_START', () => {
      it('adds agent at root level (no parent)', () => {
        const event: ToolEvent = {
          type: 'agent_start',
          tool_name: 'Agent',
          tool_use_id: 'agent_1',
          parent_agent_id: null,
          agent_type: 'code_agent',
          description: 'Test agent',
          timestamp: '2025-01-01T00:00:00Z',
        };

        const action: TreeAction = { type: 'AGENT_START', event, sequence: 1 };
        const result = treeReducer([], action);

        expect(result).toHaveLength(1);
        expect(result[0].tool_use_id).toBe('agent_1');
        expect((result[0] as AgentNode).agent_type).toBe('code_agent');
        expect((result[0] as AgentNode).description).toBe('Test agent');
        expect(result[0].status).toBe('running');
        expect((result[0] as AgentNode).children).toEqual([]);
      });

      it('adds agent under parent', () => {
        const parentAgent: AgentNode = {
          tool_use_id: 'agent_1',
          agent_type: 'orchestrator',
          tool_name: 'Agent',
          timestamp: '2025-01-01T00:00:00Z',
          children: [],
          status: 'running',
        };

        const event: ToolEvent = {
          type: 'agent_start',
          tool_name: 'Agent',
          tool_use_id: 'agent_2',
          parent_agent_id: 'agent_1',
          agent_type: 'code_agent',
          description: 'Child agent',
          timestamp: '2025-01-01T00:00:01Z',
        };

        const action: TreeAction = { type: 'AGENT_START', event, sequence: 2 };
        const result = treeReducer([parentAgent], action);

        expect(result).toHaveLength(1);
        expect((result[0] as AgentNode).children).toHaveLength(1);
        expect((result[0] as AgentNode).children[0].tool_use_id).toBe('agent_2');
      });

      it('defaults agent_type to "agent" if not provided', () => {
        const event: ToolEvent = {
          type: 'agent_start',
          tool_name: 'Agent',
          tool_use_id: 'agent_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:00Z',
        };

        const action: TreeAction = { type: 'AGENT_START', event, sequence: 1 };
        const result = treeReducer([], action);

        expect((result[0] as AgentNode).agent_type).toBe('agent');
      });
    });

    describe('TOOL_START', () => {
      it('adds tool at root level (no parent)', () => {
        const event: ToolEvent = {
          type: 'tool_start',
          tool_name: 'Read',
          tool_use_id: 'tool_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:00Z',
          parameters: { file_path: '/test.txt' },
        };

        const action: TreeAction = { type: 'TOOL_START', event, sequence: 1 };
        const result = treeReducer([], action);

        expect(result).toHaveLength(1);
        expect(result[0].tool_use_id).toBe('tool_1');
        expect(result[0].tool_name).toBe('Read');
        expect(result[0].status).toBe('running');
        expect((result[0] as ToolNode).parameters).toEqual({ file_path: '/test.txt' });
      });

      it('adds tool under parent agent', () => {
        const parentAgent: AgentNode = {
          tool_use_id: 'agent_1',
          agent_type: 'code_agent',
          tool_name: 'Agent',
          timestamp: '2025-01-01T00:00:00Z',
          children: [],
          status: 'running',
        };

        const event: ToolEvent = {
          type: 'tool_start',
          tool_name: 'Write',
          tool_use_id: 'tool_1',
          parent_agent_id: 'agent_1',
          timestamp: '2025-01-01T00:00:01Z',
          parameters: { file_path: '/output.txt', content: 'Hello' },
        };

        const action: TreeAction = { type: 'TOOL_START', event, sequence: 2 };
        const result = treeReducer([parentAgent], action);

        expect(result).toHaveLength(1);
        expect((result[0] as AgentNode).children).toHaveLength(1);
        expect((result[0] as AgentNode).children[0].tool_use_id).toBe('tool_1');
      });
    });

    describe('TOOL_COMPLETE', () => {
      it('marks tool as completed on success', () => {
        const runningTool: ToolNode = {
          tool_use_id: 'tool_1',
          tool_name: 'Read',
          timestamp: '2025-01-01T00:00:00Z',
          status: 'running',
          parent_agent_id: null,
        };

        const event: ToolEvent = {
          type: 'tool_complete',
          tool_name: 'Read',
          tool_use_id: 'tool_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:01Z',
          success: true,
          duration_ms: 1234,
        };

        const action: TreeAction = { type: 'TOOL_COMPLETE', event };
        const result = treeReducer([runningTool], action);

        expect(result[0].status).toBe('completed');
        expect(result[0].duration_ms).toBe(1234);
      });

      it('marks tool as failed on error', () => {
        const runningTool: ToolNode = {
          tool_use_id: 'tool_1',
          tool_name: 'Write',
          timestamp: '2025-01-01T00:00:00Z',
          status: 'running',
          parent_agent_id: null,
        };

        const event: ToolEvent = {
          type: 'tool_complete',
          tool_name: 'Write',
          tool_use_id: 'tool_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:01Z',
          success: false,
          error: 'File not writable',
          duration_ms: 100,
        };

        const action: TreeAction = { type: 'TOOL_COMPLETE', event };
        const result = treeReducer([runningTool], action);

        expect(result[0].status).toBe('failed');
        expect((result[0] as ToolNode).error).toBe('File not writable');
        expect(result[0].duration_ms).toBe(100);
      });

      it('marks as completed for "Worker restarted" error', () => {
        const runningTool: ToolNode = {
          tool_use_id: 'tool_1',
          tool_name: 'Bash',
          timestamp: '2025-01-01T00:00:00Z',
          status: 'running',
          parent_agent_id: null,
        };

        const event: ToolEvent = {
          type: 'tool_complete',
          tool_name: 'Bash',
          tool_use_id: 'tool_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:01Z',
          success: false,
          error: 'Worker restarted',
          duration_ms: 50,
        };

        const action: TreeAction = { type: 'TOOL_COMPLETE', event };
        const result = treeReducer([runningTool], action);

        expect(result[0].status).toBe('completed');
        expect((result[0] as ToolNode).error).toBeUndefined();
      });
    });

    describe('AGENT_STOP', () => {
      it('marks agent as completed', () => {
        const runningAgent: AgentNode = {
          tool_use_id: 'agent_1',
          agent_type: 'code_agent',
          tool_name: 'Agent',
          timestamp: '2025-01-01T00:00:00Z',
          children: [],
          status: 'running',
        };

        const event: ToolEvent = {
          type: 'agent_stop',
          tool_name: 'Agent',
          tool_use_id: 'agent_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:10Z',
          duration_ms: 10000,
          transcript_path: '/path/to/transcript',
          summary: 'Agent completed successfully',
        };

        const action: TreeAction = { type: 'AGENT_STOP', event };
        const result = treeReducer([runningAgent], action);

        expect(result[0].status).toBe('completed');
        expect(result[0].duration_ms).toBe(10000);
        expect((result[0] as AgentNode).transcript_path).toBe('/path/to/transcript');
        expect((result[0] as AgentNode).summary).toBe('Agent completed successfully');
      });

      it('marks agent as failed on error', () => {
        const runningAgent: AgentNode = {
          tool_use_id: 'agent_1',
          agent_type: 'code_agent',
          tool_name: 'Agent',
          timestamp: '2025-01-01T00:00:00Z',
          children: [],
          status: 'running',
        };

        const event: ToolEvent = {
          type: 'agent_stop',
          tool_name: 'Agent',
          tool_use_id: 'agent_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:05Z',
          error: 'Agent crashed',
          duration_ms: 5000,
        };

        const action: TreeAction = { type: 'AGENT_STOP', event };
        const result = treeReducer([runningAgent], action);

        expect(result[0].status).toBe('failed');
        expect((result[0] as AgentNode).error).toBe('Agent crashed');
      });

      it('marks as completed for "Worker restarted" error', () => {
        const runningAgent: AgentNode = {
          tool_use_id: 'agent_1',
          agent_type: 'code_agent',
          tool_name: 'Agent',
          timestamp: '2025-01-01T00:00:00Z',
          children: [],
          status: 'running',
        };

        const event: ToolEvent = {
          type: 'agent_stop',
          tool_name: 'Agent',
          tool_use_id: 'agent_1',
          parent_agent_id: null,
          timestamp: '2025-01-01T00:00:05Z',
          error: 'Worker restarted',
          duration_ms: 5000,
        };

        const action: TreeAction = { type: 'AGENT_STOP', event };
        const result = treeReducer([runningAgent], action);

        expect(result[0].status).toBe('completed');
        expect((result[0] as AgentNode).error).toBeUndefined();
      });
    });

    describe('LOAD_HISTORY', () => {
      it('builds tree from event history', () => {
        const events: ToolEvent[] = [
          {
            type: 'agent_start',
            tool_name: 'Agent',
            tool_use_id: 'agent_1',
            parent_agent_id: null,
            agent_type: 'code_agent',
            timestamp: '2025-01-01T00:00:00Z',
          },
          {
            type: 'tool_start',
            tool_name: 'Read',
            tool_use_id: 'tool_1',
            parent_agent_id: 'agent_1',
            timestamp: '2025-01-01T00:00:01Z',
          },
          {
            type: 'tool_complete',
            tool_name: 'Read',
            tool_use_id: 'tool_1',
            parent_agent_id: 'agent_1',
            timestamp: '2025-01-01T00:00:02Z',
            success: true,
            duration_ms: 1000,
          },
          {
            type: 'agent_stop',
            tool_name: 'Agent',
            tool_use_id: 'agent_1',
            parent_agent_id: null,
            timestamp: '2025-01-01T00:00:03Z',
            duration_ms: 3000,
          },
        ];

        const action: TreeAction = { type: 'LOAD_HISTORY', events };
        const result = treeReducer([], action);

        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('completed');
        expect((result[0] as AgentNode).children).toHaveLength(1);
        expect((result[0] as AgentNode).children[0].status).toBe('completed');
      });

      it('handles nested agents in history', () => {
        const events: ToolEvent[] = [
          {
            type: 'agent_start',
            tool_name: 'Agent',
            tool_use_id: 'agent_1',
            parent_agent_id: null,
            agent_type: 'orchestrator',
            timestamp: '2025-01-01T00:00:00Z',
          },
          {
            type: 'agent_start',
            tool_name: 'Agent',
            tool_use_id: 'agent_2',
            parent_agent_id: 'agent_1',
            agent_type: 'code_agent',
            timestamp: '2025-01-01T00:00:01Z',
          },
          {
            type: 'tool_start',
            tool_name: 'Write',
            tool_use_id: 'tool_1',
            parent_agent_id: 'agent_2',
            timestamp: '2025-01-01T00:00:02Z',
            parameters: { file_path: '/test.txt' },
          },
        ];

        const action: TreeAction = { type: 'LOAD_HISTORY', events };
        const result = treeReducer([], action);

        expect(result).toHaveLength(1);
        const rootAgent = result[0] as AgentNode;
        expect(rootAgent.children).toHaveLength(1);
        const childAgent = rootAgent.children[0] as AgentNode;
        expect(childAgent.children).toHaveLength(1);
        expect(childAgent.children[0].tool_use_id).toBe('tool_1');
      });

      it('assigns sequence numbers', () => {
        const events: ToolEvent[] = [
          {
            type: 'agent_start',
            tool_name: 'Agent',
            tool_use_id: 'agent_1',
            parent_agent_id: null,
            timestamp: '2025-01-01T00:00:00Z',
          },
          {
            type: 'tool_start',
            tool_name: 'Read',
            tool_use_id: 'tool_1',
            parent_agent_id: null,
            timestamp: '2025-01-01T00:00:01Z',
          },
        ];

        const action: TreeAction = { type: 'LOAD_HISTORY', events };
        const result = treeReducer([], action);

        expect((result[0] as AgentNode).sequence).toBe(1);
        expect((result[1] as ToolNode).sequence).toBe(2);
      });

      it('handles empty history', () => {
        const action: TreeAction = { type: 'LOAD_HISTORY', events: [] };
        const result = treeReducer([], action);

        expect(result).toEqual([]);
      });
    });

    describe('CLEAR', () => {
      it('clears the tree', () => {
        const tree: ActivityNode[] = [
          {
            tool_use_id: 'tool_1',
            tool_name: 'Read',
            timestamp: '2025-01-01T00:00:00Z',
            status: 'completed',
            parent_agent_id: null,
          },
        ];

        const action: TreeAction = { type: 'CLEAR' };
        const result = treeReducer(tree, action);

        expect(result).toEqual([]);
      });
    });

    describe('MARK_ALL_STOPPED', () => {
      it('marks all running nodes as stopped', () => {
        const tree: ActivityNode[] = [
          {
            tool_use_id: 'tool_1',
            tool_name: 'Read',
            timestamp: '2025-01-01T00:00:00Z',
            status: 'running',
            parent_agent_id: null,
          },
          {
            tool_use_id: 'agent_1',
            agent_type: 'code_agent',
            tool_name: 'Agent',
            timestamp: '2025-01-01T00:00:01Z',
            children: [],
            status: 'running',
          },
        ];

        const action: TreeAction = { type: 'MARK_ALL_STOPPED' };
        const result = treeReducer(tree, action);

        expect(result[0].status).toBe('stopped');
        expect(result[1].status).toBe('stopped');
      });
    });

    describe('TOOL_PROGRESS', () => {
      it('updates elapsed_seconds for tool', () => {
        const tree: ActivityNode[] = [
          {
            tool_use_id: 'tool_1',
            tool_name: 'Bash',
            timestamp: '2025-01-01T00:00:00Z',
            status: 'running',
            parent_agent_id: null,
          },
        ];

        const action: TreeAction = { type: 'TOOL_PROGRESS', toolUseId: 'tool_1', elapsedSeconds: 30 };
        const result = treeReducer(tree, action);

        expect((result[0] as ToolNode).elapsed_seconds).toBe(30);
      });

      it('updates nested tool progress', () => {
        const tree: ActivityNode[] = [
          {
            tool_use_id: 'agent_1',
            agent_type: 'code_agent',
            tool_name: 'Agent',
            timestamp: '2025-01-01T00:00:00Z',
            children: [
              {
                tool_use_id: 'tool_1',
                tool_name: 'Bash',
                timestamp: '2025-01-01T00:00:01Z',
                status: 'running',
                parent_agent_id: 'agent_1',
              },
            ],
            status: 'running',
          },
        ];

        const action: TreeAction = { type: 'TOOL_PROGRESS', toolUseId: 'tool_1', elapsedSeconds: 45 };
        const result = treeReducer(tree, action);

        expect(((result[0] as AgentNode).children[0] as ToolNode).elapsed_seconds).toBe(45);
      });
    });

    describe('SET_TREE', () => {
      it('replaces tree with provided tree', () => {
        const oldTree: ActivityNode[] = [
          {
            tool_use_id: 'tool_1',
            tool_name: 'Read',
            timestamp: '2025-01-01T00:00:00Z',
            status: 'completed',
            parent_agent_id: null,
          },
        ];

        const newTree: ActivityNode[] = [
          {
            tool_use_id: 'tool_2',
            tool_name: 'Write',
            timestamp: '2025-01-01T00:00:01Z',
            status: 'running',
            parent_agent_id: null,
          },
        ];

        const action: TreeAction = { type: 'SET_TREE', tree: newTree };
        const result = treeReducer(oldTree, action);

        expect(result).toBe(newTree);
        expect(result).toHaveLength(1);
        expect(result[0].tool_use_id).toBe('tool_2');
      });
    });
  });

  describe('checkHasRunningAgents', () => {
    it('returns true if there is a running node at root', () => {
      const tree: ActivityNode[] = [
        {
          tool_use_id: 'tool_1',
          tool_name: 'Read',
          timestamp: '2025-01-01T00:00:00Z',
          status: 'running',
          parent_agent_id: null,
        },
      ];

      expect(checkHasRunningAgents(tree)).toBe(true);
    });

    it('returns true if there is a running node nested', () => {
      const tree: ActivityNode[] = [
        {
          tool_use_id: 'agent_1',
          agent_type: 'code_agent',
          tool_name: 'Agent',
          timestamp: '2025-01-01T00:00:00Z',
          children: [
            {
              tool_use_id: 'tool_1',
              tool_name: 'Write',
              timestamp: '2025-01-01T00:00:01Z',
              status: 'running',
              parent_agent_id: 'agent_1',
            },
          ],
          status: 'completed',
        },
      ];

      expect(checkHasRunningAgents(tree)).toBe(true);
    });

    it('returns false if all nodes are completed', () => {
      const tree: ActivityNode[] = [
        {
          tool_use_id: 'tool_1',
          tool_name: 'Read',
          timestamp: '2025-01-01T00:00:00Z',
          status: 'completed',
          parent_agent_id: null,
        },
        {
          tool_use_id: 'tool_2',
          tool_name: 'Write',
          timestamp: '2025-01-01T00:00:01Z',
          status: 'completed',
          parent_agent_id: null,
        },
      ];

      expect(checkHasRunningAgents(tree)).toBe(false);
    });

    it('returns false for empty tree', () => {
      expect(checkHasRunningAgents([])).toBe(false);
    });

    it('returns false if all nodes are failed or stopped', () => {
      const tree: ActivityNode[] = [
        {
          tool_use_id: 'tool_1',
          tool_name: 'Read',
          timestamp: '2025-01-01T00:00:00Z',
          status: 'failed',
          parent_agent_id: null,
        },
        {
          tool_use_id: 'tool_2',
          tool_name: 'Write',
          timestamp: '2025-01-01T00:00:01Z',
          status: 'stopped',
          parent_agent_id: null,
        },
      ];

      expect(checkHasRunningAgents(tree)).toBe(false);
    });
  });

  describe('useActivityTree hook', () => {
    it('initializes with empty tree', () => {
      const { result } = renderHook(() => useActivityTree());

      expect(result.current.activityTree).toEqual([]);
      expect(result.current.activityTreeRef.current).toEqual([]);
    });

    it('dispatches AGENT_START and updates tree', () => {
      const { result } = renderHook(() => useActivityTree());

      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'agent_1',
        parent_agent_id: null,
        agent_type: 'code_agent',
        timestamp: '2025-01-01T00:00:00Z',
      };

      act(() => {
        result.current.dispatchTree({ type: 'AGENT_START', event, sequence: 1 });
      });

      expect(result.current.activityTree).toHaveLength(1);
      expect(result.current.activityTree[0].tool_use_id).toBe('agent_1');
      expect(result.current.activityTreeRef.current).toHaveLength(1);
    });

    it('dispatches CLEAR and empties tree', () => {
      const { result } = renderHook(() => useActivityTree());

      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      act(() => {
        result.current.dispatchTree({ type: 'TOOL_START', event, sequence: 1 });
      });

      expect(result.current.activityTree).toHaveLength(1);

      act(() => {
        result.current.dispatchTree({ type: 'CLEAR' });
      });

      expect(result.current.activityTree).toEqual([]);
    });

    it('hasRunningAgents returns correct value', () => {
      const { result } = renderHook(() => useActivityTree());

      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      act(() => {
        result.current.dispatchTree({ type: 'TOOL_START', event, sequence: 1 });
      });

      expect(result.current.hasRunningAgents(result.current.activityTree)).toBe(true);

      const completeEvent: ToolEvent = {
        type: 'tool_complete',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:01Z',
        success: true,
        duration_ms: 1000,
      };

      act(() => {
        result.current.dispatchTree({ type: 'TOOL_COMPLETE', event: completeEvent });
      });

      expect(result.current.hasRunningAgents(result.current.activityTree)).toBe(false);
    });

    it('keeps ref in sync with state', () => {
      const { result } = renderHook(() => useActivityTree());

      const event1: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      act(() => {
        result.current.dispatchTree({ type: 'TOOL_START', event: event1, sequence: 1 });
      });

      expect(result.current.activityTreeRef.current).toEqual(result.current.activityTree);

      const event2: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Write',
        tool_use_id: 'tool_2',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:01Z',
      };

      act(() => {
        result.current.dispatchTree({ type: 'TOOL_START', event: event2, sequence: 2 });
      });

      expect(result.current.activityTreeRef.current).toEqual(result.current.activityTree);
    });
  });
});
