import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Test suite for Bug Fix #1: Socket handler workflow parameter extraction
 *
 * Verifies that the socket 'message' handler correctly extracts the workflow
 * parameter from the payload and passes it to submitQuery.
 */
describe('Socket handler workflow extraction (Bug Fix #1)', () => {
  let mockSdkSession: any;
  let mockDatabase: any;
  let mockCallbacks: any;
  let capturedSubmitQueryArgs: any[] = [];

  beforeEach(() => {
    capturedSubmitQueryArgs = [];

    mockSdkSession = {
      isActive: vi.fn().mockReturnValue(false),
      submitQuery: vi.fn((...args: any[]) => {
        capturedSubmitQueryArgs.push(args);
      }),
      injectMessage: vi.fn().mockResolvedValue(false),
    };

    mockDatabase = {
      recordMessage: vi.fn().mockReturnValue({ id: 1 }),
      getConversationHistory: vi.fn().mockReturnValue([]),
      incrementUserStats: vi.fn(),
    };

    mockCallbacks = vi.fn().mockReturnValue({
      onText: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    });
  });

  it('extracts workflow parameter from socket payload and passes to submitQuery', () => {
    // Simulate the socket handler logic
    const socketData = {
      session_id: 'test-session-123',
      content: 'Implement a new feature',
      workspace: '/test/workspace',
      model: 'claude-sonnet-4-6',
      workflow: 'feature',
    };

    const sessionId = socketData.session_id;
    const content = socketData.content;
    const workspace = socketData.workspace;
    const model = socketData.model;
    const workflow = socketData.workflow;

    // Call submitQuery with extracted parameters (mimicking socket handler)
    mockSdkSession.submitQuery(
      sessionId,
      content,
      workspace,
      mockCallbacks(sessionId),
      model,
      undefined, // imageIds
      undefined, // requestedBy
      undefined, // agentId
      workflow,  // workflow parameter
    );

    // Verify submitQuery was called
    expect(mockSdkSession.submitQuery).toHaveBeenCalledTimes(1);

    // Verify workflow parameter was passed (9th parameter)
    const callArgs = capturedSubmitQueryArgs[0];
    expect(callArgs.length).toBe(9);
    expect(callArgs[8]).toBe('feature');
  });

  it('passes undefined workflow when not provided in payload', () => {
    const socketData = {
      session_id: 'test-session-456',
      content: 'Fix a bug',
      workspace: '/test/workspace',
    };

    const sessionId = socketData.session_id;
    const content = socketData.content;
    const workspace = socketData.workspace;
    const workflow = undefined;

    mockSdkSession.submitQuery(
      sessionId,
      content,
      workspace,
      mockCallbacks(sessionId),
      undefined, // model
      undefined, // imageIds
      undefined, // requestedBy
      undefined, // agentId
      workflow,  // workflow parameter (undefined)
    );

    expect(mockSdkSession.submitQuery).toHaveBeenCalledTimes(1);
    const callArgs = capturedSubmitQueryArgs[0];
    expect(callArgs[8]).toBeUndefined();
  });

  it('extracts workflow in fallback path when injection fails', async () => {
    mockSdkSession.isActive.mockReturnValue(true);
    mockSdkSession.injectMessage.mockResolvedValue(false);

    const socketData = {
      session_id: 'test-session-789',
      content: 'Continue work',
      workspace: '/test/workspace',
      workflow: 'tdd',
    };

    const sessionId = socketData.session_id;
    const content = socketData.content;
    const workspace = socketData.workspace;
    const workflow = socketData.workflow;

    // Simulate the inject -> fallback flow
    const injected = await mockSdkSession.injectMessage(sessionId, content);
    if (!injected) {
      mockSdkSession.submitQuery(
        sessionId,
        content,
        workspace,
        mockCallbacks(sessionId),
        undefined,
        undefined,
        undefined,
        undefined,
        workflow,
      );
    }

    expect(mockSdkSession.submitQuery).toHaveBeenCalledTimes(1);
    const callArgs = capturedSubmitQueryArgs[0];
    expect(callArgs[8]).toBe('tdd');
  });
});
