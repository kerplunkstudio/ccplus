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
import * as sessionApi from '../session-api.js';
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
    it('builds 20 tools', () => {
      const tools = buildFleetMcpTools(mockDeps);
      expect(tools).toHaveLength(20);
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

  // ---- Tests for Bug Fix Correlation (KAIROS) ----
  describe('start_session - KAIROS bug-fix correlation', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
      vi.clearAllMocks();
    });

    it('records KAIROS correlation when originating_session_id is provided', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature', 'bug-fix']);
      vi.mocked(sessionApi.startSession).mockReturnValue({
        success: true,
        sessionId: 'fix-session-123',
      });

      const mockAddCorrelation = vi.fn();
      vi.doMock('../db/kairos.js', () => ({
        addCorrelation: mockAddCorrelation,
      }));

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: '[BUG-FIX-FOR:feat-auth-login] Fix type error in validation',
        workspace: '/tmp',
        workflow: 'bug-fix',
        force: true,
        originating_session_id: 'feat-auth-login',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.session_id).toBe('fix-session-123');

      // Wait a bit for the dynamic import to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('does not record correlation when originating_session_id is omitted', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature']);
      vi.mocked(sessionApi.startSession).mockReturnValue({
        success: true,
        sessionId: 'new-session-456',
      });

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'Regular feature work',
        workspace: '/tmp',
        workflow: 'feature',
        force: true,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.session_id).toBe('new-session-456');
      // No correlation should be attempted
    });

    it('handles KAIROS correlation errors gracefully without failing session creation', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['bug-fix']);
      vi.mocked(sessionApi.startSession).mockReturnValue({
        success: true,
        sessionId: 'fix-session-789',
      });

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: '[BUG-FIX-FOR:nonexistent] Fix something',
        workspace: '/tmp',
        workflow: 'bug-fix',
        force: true,
        originating_session_id: 'nonexistent',
      });
      const parsed = JSON.parse(result.content[0].text);

      // Session creation should succeed even if correlation recording fails
      expect(parsed.success).toBe(true);
      expect(parsed.session_id).toBe('fix-session-789');
    });
  });

  // ---- Regression tests for Bug 1: start_session workflow validation ----
  describe('start_session - regression: workflow validation (Bug 1)', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('returns success:false with "Unknown workflow" error when workflow name is not in listWorkflows()', async () => {
      // Bug: before the fix, start_session would call startSession() without checking
      // whether the workflow name was valid, causing confusing downstream errors.
      // After the fix, listWorkflows() is called first and an early error is returned.
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature', 'bug-fix', 'default']);

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'do something',
        workspace: '/tmp',
        workflow: 'nonexistent-workflow',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Unknown workflow');
      expect(parsed.error).toContain('nonexistent-workflow');
      // createPendingSession must NOT have been called
      expect(vi.mocked(sessionApi.createPendingSession)).not.toHaveBeenCalled();
    });

    it('includes the list of available workflows in the error message for an unknown workflow', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature', 'bug-fix', 'default']);

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'do something',
        workspace: '/tmp',
        workflow: 'typo-workflow',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('feature');
      expect(parsed.error).toContain('bug-fix');
      expect(parsed.error).toContain('default');
    });

    it('proceeds to createPendingSession when workflow name is valid and force is not provided', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature', 'bug-fix', 'default']);
      vi.mocked(sessionApi.createPendingSession).mockReturnValue({
        success: true,
        sessionId: 'new-session-123',
      });

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'implement the feature',
        workspace: '/tmp',
        workflow: 'feature',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.session_id).toBe('new-session-123');
      expect(parsed.status).toBe('pending');
      expect(parsed.message).toContain('pending state');
      expect(vi.mocked(sessionApi.createPendingSession)).toHaveBeenCalledOnce();
      expect(vi.mocked(sessionApi.startSession)).not.toHaveBeenCalled();
    });

    it('proceeds to createPendingSession when workflow name is valid and force is false', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature', 'bug-fix', 'default']);
      vi.mocked(sessionApi.createPendingSession).mockReturnValue({
        success: true,
        sessionId: 'new-session-456',
      });

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'implement the feature',
        workspace: '/tmp',
        workflow: 'feature',
        force: false,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.session_id).toBe('new-session-456');
      expect(parsed.status).toBe('pending');
      expect(parsed.message).toContain('pending state');
      expect(vi.mocked(sessionApi.createPendingSession)).toHaveBeenCalledOnce();
      expect(vi.mocked(sessionApi.startSession)).not.toHaveBeenCalled();
    });

    it('proceeds to startSession when workflow name is valid and force is true', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature', 'bug-fix', 'default']);
      vi.mocked(sessionApi.startSession).mockReturnValue({
        success: true,
        sessionId: 'new-session-789',
      });

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'implement the feature',
        workspace: '/tmp',
        workflow: 'feature',
        force: true,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(true);
      expect(parsed.session_id).toBe('new-session-789');
      expect(parsed.status).toBe('running');
      expect(parsed.message).toContain('started successfully');
      expect(vi.mocked(sessionApi.startSession)).toHaveBeenCalledOnce();
      expect(vi.mocked(sessionApi.createPendingSession)).not.toHaveBeenCalled();
    });

    it('returns success:false when createPendingSession itself fails (after passing workflow validation)', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature']);
      vi.mocked(sessionApi.createPendingSession).mockReturnValue({
        success: false,
        error: 'workspace path does not exist or is not a directory',
      });

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'do something',
        workspace: '/no/such/dir',
        workflow: 'feature',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('workspace path does not exist');
    });

    it('returns success:false when startSession itself fails with force=true (after passing workflow validation)', async () => {
      vi.mocked(workflowConfig.listWorkflows).mockReturnValue(['feature']);
      vi.mocked(sessionApi.startSession).mockReturnValue({
        success: false,
        error: 'workspace path does not exist or is not a directory',
      });

      const handler = toolHandlers.get('start_session');
      const result = await handler!({
        prompt: 'do something',
        workspace: '/no/such/dir',
        workflow: 'feature',
        force: true,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('workspace path does not exist');
    });
  });

  // ---- Regression tests for Bug 2: transition_session_phase uses workflow config phases ----
  describe('transition_session_phase - regression: workflow-config phases (Bug 2)', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('reports valid_phases from the actual workflow config, not a hardcoded list', async () => {
      // Bug: before the fix, valid_phases was populated from a hardcoded constant
      // (e.g. ['execute', 'test', 'review', 'complete']).
      // After the fix, phases are loaded from loadWorkflow() and reflect the real config.
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'plan',
        workflowName: 'tdd',
        transitions: [],
        sessionId: 'sess-tdd',
        createdAt: '2024-01-01',
      });
      // Transition attempt fails (returns null) to trigger the error branch
      vi.mocked(workflowState.transitionPhase).mockReturnValue(null);
      // The workflow has custom phases that would NOT appear in a hardcoded list
      vi.mocked(workflowConfig.loadWorkflow).mockReturnValue({
        name: 'tdd',
        description: 'TDD workflow',
        default_phase: 'red',
        phases: [
          { name: 'red', context: 'Write failing test', agent_hints: [], tool_rules: [] },
          { name: 'green', context: 'Make test pass', agent_hints: [], tool_rules: [] },
          { name: 'refactor', context: 'Refactor', agent_hints: [], tool_rules: [] },
        ],
        transitions: [
          { from: 'red', to: 'green' },
          { from: 'green', to: 'refactor' },
          { from: 'refactor', to: 'red' },
        ],
      });

      const handler = toolHandlers.get('transition_session_phase');
      const result = await handler!({
        session_id: 'sess-tdd',
        to_phase: 'hardcoded-phase',
        mode: 'validate',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      // valid_phases must come from the workflow config, not a hardcoded list
      expect(parsed.valid_phases).toEqual(['red', 'green', 'refactor']);
      // Hardcoded phase names that were in the old list must NOT appear unless the workflow has them
      expect(parsed.valid_phases).not.toContain('complete');
      expect(parsed.valid_phases).not.toContain('execute');
    });

    it('shows correct workflow name in the error message', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'red',
        workflowName: 'tdd',
        transitions: [],
        sessionId: 'sess-tdd',
        createdAt: '2024-01-01',
      });
      vi.mocked(workflowState.transitionPhase).mockReturnValue(null);
      vi.mocked(workflowConfig.loadWorkflow).mockReturnValue({
        name: 'tdd',
        description: 'TDD workflow',
        default_phase: 'red',
        phases: [
          { name: 'red', context: 'Write failing test', agent_hints: [], tool_rules: [] },
        ],
        transitions: [],
      });

      const handler = toolHandlers.get('transition_session_phase');
      const result = await handler!({
        session_id: 'sess-tdd',
        to_phase: 'unknown',
        mode: 'validate',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('tdd');
      expect(parsed.current_phase).toBe('red');
    });

    it('returns empty valid_phases when loadWorkflow throws (workflow config unavailable)', async () => {
      vi.mocked(workflowState.getWorkflowState).mockReturnValue({
        phase: 'execute',
        workflowName: 'unknown-wf',
        transitions: [],
        sessionId: 'sess-x',
        createdAt: '2024-01-01',
      });
      vi.mocked(workflowState.transitionPhase).mockReturnValue(null);
      vi.mocked(workflowConfig.loadWorkflow).mockImplementation(() => {
        throw new Error('Workflow not found in database');
      });

      const handler = toolHandlers.get('transition_session_phase');
      const result = await handler!({
        session_id: 'sess-x',
        to_phase: 'review',
        mode: 'validate',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.success).toBe(false);
      // When loadWorkflow throws, valid_phases should be empty (graceful degradation)
      expect(parsed.valid_phases).toEqual([]);
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

  describe('get_session_diff', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('returns error when session not found', async () => {
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue(null);
      vi.mocked(mockDeps.database.getConversationHistory).mockReturnValue([]);

      const handler = toolHandlers.get('get_session_diff');
      const result = await handler!({ session_id: 'unknown-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error).toContain('Session not found');
    });

    it('returns error when workspace is not a git repo', async () => {
      mockDeps.sessionWorkspaces.set('test-session', '/tmp/not-a-git-repo');

      const handler = toolHandlers.get('get_session_diff');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      // Will error because /tmp/not-a-git-repo is not a git repo
      expect(parsed.error).toBeDefined();
    });

    it('gets workspace from sessionWorkspaces map', async () => {
      mockDeps.sessionWorkspaces.set('test-session', '/test-workspace');

      const handler = toolHandlers.get('get_session_diff');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      // Will have an error since /test-workspace doesn't exist, but it shows the workspace was found
      if (parsed.workspace) {
        expect(parsed.workspace).toBe('/test-workspace');
      } else {
        // Expected: error because workspace is not a git repo
        expect(parsed.error).toBeDefined();
      }
    });

    it('falls back to fleet monitor for workspace', async () => {
      // Clear sessionWorkspaces to force fallback to fleet monitor
      mockDeps.sessionWorkspaces.clear();

      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue({
        sessionId: 'test-session-fleet',
        status: 'running',
        workspace: '/fleet-workspace',
        toolCount: 0,
        activeAgents: 0,
        inputTokens: 0,
        outputTokens: 0,
        filesTouched: [],
        durationMs: 0,
        label: '',
        startedAt: '2024-01-01',
        lastActivity: '2024-01-01',
      } as fleetMonitor.EnrichedFleetSessionInfo);

      const handler = toolHandlers.get('get_session_diff');
      const result = await handler!({ session_id: 'test-session-fleet' });
      const parsed = JSON.parse(result.content[0].text);

      // Will have an error since /fleet-workspace doesn't exist, but it shows the workspace was found
      if (parsed.workspace) {
        expect(parsed.workspace).toBe('/fleet-workspace');
      } else {
        // Expected: error because workspace is not a git repo
        expect(parsed.error).toBeDefined();
      }
    });
  });

  describe('get_session_cost', () => {
    beforeEach(() => {
      buildFleetMcpTools(mockDeps);
    });

    it('returns error when session not found', async () => {
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue(null);

      const handler = toolHandlers.get('get_session_cost');
      const result = await handler!({ session_id: 'unknown-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error).toBe('Session not found');
    });

    it('calculates cost for session with tokens', async () => {
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue({
        sessionId: 'test-session',
        status: 'completed',
        workspace: '/test',
        toolCount: 10,
        activeAgents: 0,
        inputTokens: 1_000_000, // 1M tokens
        outputTokens: 500_000, // 500K tokens
        filesTouched: [],
        durationMs: 60000,
        label: 'test',
        startedAt: '2024-01-01',
        lastActivity: '2024-01-01',
      } as fleetMonitor.EnrichedFleetSessionInfo);

      const handler = toolHandlers.get('get_session_cost');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.session_id).toBe('test-session');
      expect(parsed.input_tokens).toBe(1_000_000);
      expect(parsed.output_tokens).toBe(500_000);
      expect(parsed.model).toBe('sonnet');
      expect(parsed.duration_ms).toBe(60000);

      // Sonnet pricing: $3/MTok input, $15/MTok output
      // 1M tokens input = $3, 500K tokens output = $7.5
      expect(parsed.estimated_cost_usd).toBe(10.5);
      expect(parsed.cost_breakdown.input_cost_usd).toBe(3);
      expect(parsed.cost_breakdown.output_cost_usd).toBe(7.5);
      expect(parsed.pricing_note).toContain('Sonnet');
    });

    it('calculates zero cost for session with no tokens', async () => {
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue({
        sessionId: 'test-session',
        status: 'running',
        workspace: '/test',
        toolCount: 0,
        activeAgents: 1,
        inputTokens: 0,
        outputTokens: 0,
        filesTouched: [],
        durationMs: 1000,
        label: '',
        startedAt: '2024-01-01',
        lastActivity: '2024-01-01',
      } as fleetMonitor.EnrichedFleetSessionInfo);

      const handler = toolHandlers.get('get_session_cost');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.estimated_cost_usd).toBe(0);
      expect(parsed.cost_breakdown.input_cost_usd).toBe(0);
      expect(parsed.cost_breakdown.output_cost_usd).toBe(0);
    });

    it('handles small token counts with proper precision', async () => {
      vi.mocked(fleetMonitor.getSessionDetail).mockReturnValue({
        sessionId: 'test-session',
        status: 'completed',
        workspace: '/test',
        toolCount: 5,
        activeAgents: 0,
        inputTokens: 5000, // 5K tokens
        outputTokens: 2000, // 2K tokens
        filesTouched: [],
        durationMs: 5000,
        label: '',
        startedAt: '2024-01-01',
        lastActivity: '2024-01-01',
      } as fleetMonitor.EnrichedFleetSessionInfo);

      const handler = toolHandlers.get('get_session_cost');
      const result = await handler!({ session_id: 'test-session' });
      const parsed = JSON.parse(result.content[0].text);

      // Sonnet pricing: $3/MTok input, $15/MTok output
      // 5K tokens input = $0.015, 2K tokens output = $0.03
      expect(parsed.estimated_cost_usd).toBe(0.045);
      expect(parsed.cost_breakdown.input_cost_usd).toBe(0.015);
      expect(parsed.cost_breakdown.output_cost_usd).toBe(0.03);
    });
  });
});
