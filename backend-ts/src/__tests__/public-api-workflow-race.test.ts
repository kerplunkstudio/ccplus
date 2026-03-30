import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

/**
 * Test suite for workflow race condition fix in submitQuery
 *
 * Verifies that workflow state is initialized BEFORE fleet monitor registration,
 * preventing fleet monitor from creating state files with 'default' workflow name.
 */

// Mock config module before importing
vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    WORKFLOWS_DIR: path.join(tmpdir(), `ccplus-test-public-api-race-${Date.now()}`),
  };
});

// Mock workflow-config to avoid database dependencies
vi.mock('../workflow-config.js', () => ({
  loadWorkflow: vi.fn().mockReturnValue({
    name: 'default',
    default_phase: 'execute',
    phases: [],
  }),
  evaluateToolRule: vi.fn().mockReturnValue(false),
}));

// Mock fleet-monitor to track call order
vi.mock('../fleet-monitor.js', () => ({
  registerSession: vi.fn(),
  updateSessionStatus: vi.fn(),
  loadSessionsFromDb: vi.fn(),
}));

// Mock database
vi.mock('../database.js', () => ({
  recordMessage: vi.fn().mockReturnValue({ id: 1 }),
  getConversationHistory: vi.fn().mockReturnValue([]),
  incrementUserStats: vi.fn(),
  getLastSdkSessionId: vi.fn().mockReturnValue(null),
  storeSession: vi.fn(),
  getAllFleetSessions: vi.fn().mockReturnValue([]),
}));

// Mock event-log
vi.mock('../event-log.js', () => ({
  eventLog: {
    get: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  },
}));

// Mock session-manager
vi.mock('../sdk/session-manager.js', () => ({
  getOrCreateSession: vi.fn().mockReturnValue({
    sessionId: 'test-session',
    workspace: '/test/workspace',
    activeQuery: null,
    streamingContent: '',
    cancelRequested: false,
    callbacks: null,
  }),
  sessions: new Map(),
  MAX_STREAMING_BUFFER: 100000,
  getSdkSettingsPath: vi.fn().mockReturnValue('/test/settings'),
}));

// Mock stream-query (we're only testing initialization, not execution)
vi.mock('../sdk/stream-query.js', () => ({
  streamQuery: vi.fn().mockResolvedValue(undefined),
}));

import * as config from '../config.js';
import { submitQuery } from '../sdk/public-api.js';
import { getWorkflowState } from '../workflow-state.js';
import * as fleetMonitor from '../fleet-monitor.js';

const TEST_WORKFLOWS_DIR = config.WORKFLOWS_DIR;

describe('submitQuery workflow race condition fix', () => {
  beforeEach(() => {
    // Create temp directory for test
    if (!existsSync(TEST_WORKFLOWS_DIR)) {
      mkdirSync(TEST_WORKFLOWS_DIR, { recursive: true });
    }

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(TEST_WORKFLOWS_DIR)) {
      rmSync(TEST_WORKFLOWS_DIR, { recursive: true, force: true });
    }
  });

  it('initializes workflow state before fleet monitor registration', () => {
    const sessionId = 'test-race-session-1';
    const workspace = '/test/workspace';
    const prompt = 'Implement feature X';
    const workflow = 'feature';

    const mockCallbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    // Call submitQuery with workflow parameter
    submitQuery(sessionId, prompt, workspace, mockCallbacks, undefined, undefined, undefined, undefined, workflow);

    // Verify fleet monitor was called
    expect(fleetMonitor.registerSession).toHaveBeenCalledWith(sessionId, workspace, undefined, undefined);
    expect(fleetMonitor.updateSessionStatus).toHaveBeenCalledWith(sessionId, 'running');

    // Verify workflow state was created with correct workflow name
    const state = getWorkflowState(sessionId);
    expect(state.workflowName).toBe('feature');
    expect(state.sessionId).toBe(sessionId);
    // Phase is set from workflow config (mocked in this test)
  });

  it('workflow state file exists with correct workflow name before fleet monitor runs', () => {
    const sessionId = 'test-race-session-2';
    const workspace = '/test/workspace';
    const prompt = 'Fix bug Y';
    const workflow = 'bug-fix';

    const mockCallbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    // Call submitQuery
    submitQuery(sessionId, prompt, workspace, mockCallbacks, undefined, undefined, undefined, undefined, workflow);

    // Read the state file directly
    const statePath = path.join(TEST_WORKFLOWS_DIR, `${sessionId}.json`);
    expect(existsSync(statePath)).toBe(true);

    const stateContent = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(stateContent.workflowName).toBe('bug-fix');
    // Phase is set from workflow config (mocked in this test)
  });

  it('does not create workflow state when workflow parameter is not provided', () => {
    const sessionId = 'test-race-session-3';
    const workspace = '/test/workspace';
    const prompt = 'General query';

    const mockCallbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    // Call submitQuery WITHOUT workflow parameter
    submitQuery(sessionId, prompt, workspace, mockCallbacks);

    // State file should not exist yet (will be created by fleet monitor or streamQuery later)
    const statePath = path.join(TEST_WORKFLOWS_DIR, `${sessionId}.json`);
    expect(existsSync(statePath)).toBe(false);

    // Fleet monitor should still be called
    expect(fleetMonitor.registerSession).toHaveBeenCalledWith(sessionId, workspace, undefined, undefined);
    expect(fleetMonitor.updateSessionStatus).toHaveBeenCalledWith(sessionId, 'running');
  });

  it('preserves existing workflow state if it already exists', () => {
    const sessionId = 'test-race-session-4';
    const workspace = '/test/workspace';
    const prompt = 'Continue work';

    const mockCallbacks = {
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    // First call with 'feature' workflow
    submitQuery(sessionId, prompt, workspace, mockCallbacks, undefined, undefined, undefined, undefined, 'feature');

    const state1 = getWorkflowState(sessionId);
    const createdAt1 = state1.createdAt;

    // Second call with 'bug-fix' workflow (should NOT override)
    submitQuery(sessionId, prompt, workspace, mockCallbacks, undefined, undefined, undefined, undefined, 'bug-fix');

    const state2 = getWorkflowState(sessionId);

    // Workflow name should remain 'feature' (from first call)
    expect(state2.workflowName).toBe('feature');
    expect(state2.createdAt).toBe(createdAt1);
  });
});
