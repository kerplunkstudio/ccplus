import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all dependencies before imports
vi.mock('../workflow-state.js');
vi.mock('../workflow-config.js');
vi.mock('../fleet-monitor.js');
vi.mock('../database.js');
vi.mock('../session-api.js');
vi.mock('../sdk-session.js');
vi.mock('../logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the SDK tool function to capture handlers
const toolHandlers = new Map<string, Function>();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, desc: string, schema: any, handler: Function) => {
    toolHandlers.set(name, handler);
    return { name, description: desc, schema, handler };
  },
}));

import { buildFleetMcpTools, type CaptainToolDependencies } from '../captain-tools.js';
import * as fleetMonitor from '../fleet-monitor.js';
import * as workflowState from '../workflow-state.js';
import * as workflowConfig from '../workflow-config.js';
import { log } from '../logger.js';

describe('captain-tools', () => {
  const mockDeps: CaptainToolDependencies = {
    database: {
      getConversationHistory: vi.fn().mockReturnValue([]),
      getToolEvents: vi.fn().mockReturnValue([]),
      getStats: vi.fn().mockReturnValue({
        total_conversations: 0,
        total_tool_events: 0,
        events_by_tool: {}
      }),
    } as any,
    sdkSession: {
      cancelQuery: vi.fn(),
      isActive: vi.fn().mockReturnValue(false),
      submitQuery: vi.fn(),
    } as any,
    sessionWorkspaces: new Map(),
    io: {},
    buildSocketCallbacks: vi.fn().mockReturnValue({}),
    log: log as any,
    getLastQuerySource: vi.fn().mockReturnValue(null),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
  });

  describe('buildFleetMcpTools', () => {
    it('builds 8 tools', () => {
      const tools = buildFleetMcpTools(mockDeps);
      expect(tools).toHaveLength(8);
    });
  });

  describe('get_session_state', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('returns workflow + fleet for existing session', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'execute',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue({
        sessionId: 'test-session',
        status: 'running',
        workspace: '/test',
        toolCount: 5,
        activeAgents: 1,
        inputTokens: 1000,
        outputTokens: 500,
        filesTouched: ['file1.ts'],
        durationMs: 30000,
        label: 'test',
        startedAt: '2024-01-01',
        lastActivity: '2024-01-01',
      } as fleetMonitor.EnrichedFleetSessionInfo);

      const handler = toolHandlers.get('get_session_state');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.session_id).toBe('test-session');
      expect(parsed.workflow.phase).toBe('execute');
      expect(parsed.workflow.name).toBe('feature');
      expect(parsed.fleet.tool_count).toBe(5);
      expect(parsed.fleet.files_touched).toEqual(['file1.ts']);
    });

    it('returns null fleet when session not in monitor', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'design',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue(null);

      const handler = toolHandlers.get('get_session_state');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.workflow.name).toBe('feature');
      expect(parsed.fleet).toBeNull();
    });

    it('includes phase_rules when workflow has tool_rules', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'review',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue(null);
      vi.mocked(workflowConfig.loadWorkflow).mockReturnValue({
        name: 'feature',
        description: 'Feature workflow',
        default_phase: 'design',
        phases: [
          {
            name: 'review',
            context: 'Review phase',
            agent_hints: [],
            tool_rules: [
              { tool_name: 'Edit', action: 'block', reason: 'No edits in review' },
              { tool_name: 'Write', action: 'warn', reason: 'Warning on writes' },
            ]
          },
        ],
        transitions: [],
      });

      const handler = toolHandlers.get('get_session_state');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.workflow.phase_rules).toBeDefined();
      expect(parsed.workflow.phase_rules.blocked).toEqual(['Edit']);
      expect(parsed.workflow.phase_rules.warned).toEqual(['Write']);
    });

    it('handles missing workflow gracefully', async () => {
      vi.mocked(workflowState.getWorkflowState).mockImplementation(() => {
        throw new Error('Workflow not found');
      });

      const handler = toolHandlers.get('get_session_state');
      const result = await handler!({ session_id: 'unknown-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error).toContain('Failed to get session state');
    });
  });

  describe('transition_session_phase', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('validate mode succeeds on valid transition', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'execute',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(workflowState.transitionPhase).mockReturnValue({
        phase: 'test',
        workflowName: 'feature',
        transitions: [{ from: 'execute', to: 'test', trigger: 'captain_manual', timestamp: '2024-01-01' }],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });

      const handler = toolHandlers.get('transition_session_phase');
      const result = await handler!({
        session_id: 'test-session',
        to_phase: 'test',
        mode: 'validate'
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.previous_phase).toBe('execute');
      expect(parsed.current_phase).toBe('test');
    });

    it('validate mode fails on invalid transition', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'execute',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(workflowState.transitionPhase).mockReturnValue(null);

      const handler = toolHandlers.get('transition_session_phase');
      const result = await handler!({
        session_id: 'test-session',
        to_phase: 'design',
        mode: 'validate'
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Cannot transition');
      expect(parsed.current_phase).toBe('execute');
    });

    it('force mode succeeds', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'execute',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(workflowState.skipToPhase).mockReturnValue({
        phase: 'review',
        workflowName: 'feature',
        transitions: [{ from: 'execute', to: 'review', trigger: 'manual_skip', timestamp: '2024-01-01' }],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });

      const handler = toolHandlers.get('transition_session_phase');
      const result = await handler!({
        session_id: 'test-session',
        to_phase: 'review',
        mode: 'force'
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.previous_phase).toBe('execute');
      expect(parsed.current_phase).toBe('review');
      expect(vi.mocked(workflowState.skipToPhase)).toHaveBeenCalledWith('test-session', 'review');
    });

    it('returns previous and current phase', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'design',
        workflowName: 'feature',
        transitions: [],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(workflowState.transitionPhase).mockReturnValue({
        phase: 'plan',
        workflowName: 'feature',
        transitions: [{ from: 'design', to: 'plan', trigger: 'test_reason', timestamp: '2024-01-01' }],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });

      const handler = toolHandlers.get('transition_session_phase');
      const result = await handler!({
        session_id: 'test-session',
        to_phase: 'plan',
        mode: 'validate',
        reason: 'test_reason'
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.previous_phase).toBe('design');
      expect(parsed.current_phase).toBe('plan');
    });
  });

  describe('list_sessions', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('includes workflow_phase and workflow_name', async () => {
      vi.mocked(fleetMonitor.getFleetState).mockReturnValue({
        sessions: [
          {
            sessionId: 'sess1',
            status: 'running',
            workspace: '/test',
            toolCount: 3,
            activeAgents: 1,
            inputTokens: 500,
            outputTokens: 200,
            durationMs: 10000,
            startedAt: '2024-01-01',
            lastActivity: '2024-01-01',
            label: 'test session',
            filesTouched: [],
            workflowPhase: 'execute',
            workflowName: 'feature',
          } as fleetMonitor.EnrichedFleetSessionInfo,
        ],
        aggregate: {
          totalSessions: 1,
          activeSessions: 1,
          totalToolCalls: 3,
          totalInputTokens: 500,
          totalOutputTokens: 200,
        },
      });

      const handler = toolHandlers.get('list_sessions');
      const result = await handler!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.sessions).toHaveLength(1);
      expect(parsed.sessions[0].workflow_phase).toBe('execute');
      expect(parsed.sessions[0].workflow_name).toBe('feature');
    });

    it('returns null workflow fields for non-running sessions', async () => {
      vi.mocked(fleetMonitor.getFleetState).mockReturnValue({
        sessions: [
          {
            sessionId: 'sess1',
            status: 'idle',
            workspace: '/test',
            toolCount: 0,
            activeAgents: 0,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            startedAt: '2024-01-01',
            lastActivity: '2024-01-01',
            label: '',
            filesTouched: [],
            workflowPhase: undefined,
            workflowName: undefined,
          } as fleetMonitor.EnrichedFleetSessionInfo,
        ],
        aggregate: {
          totalSessions: 1,
          activeSessions: 0,
          totalToolCalls: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
        },
      });

      const handler = toolHandlers.get('list_sessions');
      const result = await handler!({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.sessions[0].workflow_phase).toBeNull();
      expect(parsed.sessions[0].workflow_name).toBeNull();
    });
  });

  describe('get_session_detail', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('includes workflow state', async () => {
      vi.mocked(mockDeps.database.getConversationHistory).mockReturnValue([
        { role: 'user', content: 'Test message', timestamp: '2024-01-01', conversation_id: 'test-session' },
      ] as any);
      vi.mocked(mockDeps.database.getToolEvents).mockReturnValue([]);
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'test',
        workflowName: 'feature',
        transitions: [{ from: 'execute', to: 'test', trigger: 'manual', timestamp: '2024-01-01' }],
        sessionId: 'test-session',
        createdAt: '2024-01-01',
      });
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue({
        sessionId: 'test-session',
        status: 'running',
        workspace: '/test',
        toolCount: 5,
        activeAgents: 1,
        inputTokens: 1000,
        outputTokens: 500,
        filesTouched: ['file1.ts'],
        durationMs: 30000,
        label: 'test',
        startedAt: '2024-01-01',
        lastActivity: '2024-01-01',
      } as fleetMonitor.EnrichedFleetSessionInfo);

      const handler = toolHandlers.get('get_session_detail');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.workflow).toBeDefined();
      expect(parsed.workflow.name).toBe('feature');
      expect(parsed.workflow.phase).toBe('test');
      expect(parsed.workflow.transitions).toHaveLength(1);
      expect(parsed.fleet).toBeDefined();
    });

    it('truncates messages at 1500 chars', async () => {
      const longContent = 'a'.repeat(2000);
      vi.mocked(mockDeps.database.getConversationHistory).mockReturnValue([
        { role: 'user', content: longContent, timestamp: '2024-01-01', conversation_id: 'test-session' },
      ] as any);
      vi.mocked(mockDeps.database.getToolEvents).mockReturnValue([]);
      vi.mocked(workflowState.getWorkflowState).mockImplementation(() => {
        throw new Error('No workflow');
      });
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue(null);

      const handler = toolHandlers.get('get_session_detail');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0].content).toHaveLength(1500);
      expect(parsed.messages[0].content).toBe('a'.repeat(1500));
    });
  });
});
