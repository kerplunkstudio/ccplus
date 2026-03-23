/**
 * TEST FILE TO REPRODUCE BUG: Fleet Dashboard Showing 0 Tokens for Active Sessions
 *
 * ROOT CAUSE ANALYSIS:
 * ====================
 *
 * The fleet dashboard shows 0 tokens for active/running sessions because token counts
 * are only updated when the SDK query completes (message.type === "result").
 *
 * TOKEN FLOW:
 * 1. Query starts → fleet session registered with inputTokens=0, outputTokens=0
 * 2. During streaming → SDK emits message.type === "assistant" and "stream_event" messages
 *    - These messages DO NOT contain token usage data
 *    - fleetMonitor.updateTokens() is NEVER called during this phase
 * 3. Query completes → SDK emits message.type === "result" with usage data
 *    - fleetMonitor.updateTokens() is called ONCE at line 369 of stream-query.ts
 *    - Fleet dashboard NOW shows token counts
 *
 * EVIDENCE IN CODE:
 * - stream-query.ts:330-400 - Result handler is the ONLY place updateTokens() is called
 * - stream-query.ts:269-329 - Assistant message handler has NO token tracking
 * - stream-query.ts:402-425 - Stream event handler has NO token tracking
 *
 * THE BUG:
 * Active sessions remain at 0 tokens until completion. The SDK does not provide
 * per-message token counts during streaming - only final totals at completion.
 *
 * REPRODUCTION STRATEGY:
 * This test simulates an active session by:
 * 1. Registering a session and marking it as running
 * 2. Simulating intermediate streaming (as if assistant messages are flowing)
 * 3. NOT calling updateTokens (because the real code doesn't during streaming)
 * 4. Asserting that token counts are 0 (proving the bug)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fleetMonitor from '../fleet-monitor.js';

describe('Fleet Tokens Bug - Active Sessions Show 0 Tokens', () => {
  beforeEach(() => {
    fleetMonitor._clearSessions();
  });

  it('REPRODUCES BUG: active session shows 0 tokens during streaming', () => {
    // ARRANGE: Start a session (simulating what submitQuery does)
    const sessionId = 'active-session-1';
    fleetMonitor.registerSession(sessionId, '/workspace/test');
    fleetMonitor.updateSessionStatus(sessionId, 'running');

    // Simulate some activity (tools being called during streaming)
    fleetMonitor.incrementToolCount(sessionId);
    fleetMonitor.incrementToolCount(sessionId);
    fleetMonitor.incrementAgentCount(sessionId);

    // ACT: Get the session detail (what the frontend sees in real-time)
    const detail = fleetMonitor.getSessionDetail(sessionId);

    // ASSERT: This SHOULD FAIL (proving the bug exists)
    // In a real session, the SDK is streaming tokens but we don't track them
    // until the query completes. The frontend sees 0 tokens for active sessions.
    expect(detail?.status).toBe('running');
    expect(detail?.toolCount).toBe(2); // Tool count works fine
    expect(detail?.activeAgents).toBe(1); // Agent count works fine

    // THIS IS THE BUG: Token counts remain at 0 during active streaming
    expect(detail?.inputTokens).toBe(0); // BUG: Should reflect current usage
    expect(detail?.outputTokens).toBe(0); // BUG: Should reflect current usage
  });

  it('EXPECTED BEHAVIOR: completed session shows token counts', () => {
    // ARRANGE: Start a session
    const sessionId = 'completed-session-1';
    fleetMonitor.registerSession(sessionId, '/workspace/test');
    fleetMonitor.updateSessionStatus(sessionId, 'running');

    // Simulate some streaming activity
    fleetMonitor.incrementToolCount(sessionId);

    // ACT: Simulate query completion with token counts (what stream-query.ts does)
    fleetMonitor.updateTokens(sessionId, 1500, 800);
    fleetMonitor.updateSessionStatus(sessionId, 'completed');

    // ASSERT: Token counts are visible after completion
    const detail = fleetMonitor.getSessionDetail(sessionId);
    expect(detail?.status).toBe('completed');
    expect(detail?.inputTokens).toBe(1500); // ✓ Works for completed sessions
    expect(detail?.outputTokens).toBe(800);  // ✓ Works for completed sessions
  });

  it('REPRODUCES BUG: fleet aggregate stats show 0 tokens for all active sessions', () => {
    // ARRANGE: Create multiple active sessions
    fleetMonitor.registerSession('active-1', '/workspace/test');
    fleetMonitor.updateSessionStatus('active-1', 'running');
    fleetMonitor.incrementToolCount('active-1');

    fleetMonitor.registerSession('active-2', '/workspace/test');
    fleetMonitor.updateSessionStatus('active-2', 'running');
    fleetMonitor.incrementToolCount('active-2');
    fleetMonitor.incrementToolCount('active-2');

    // ACT: Get fleet state (what FleetMonitor.tsx renders)
    const state = fleetMonitor.getFleetState();

    // ASSERT: Aggregate shows 0 tokens because all sessions are active (bug)
    expect(state.aggregate.activeSessions).toBe(2);
    expect(state.aggregate.totalToolCalls).toBe(3); // ✓ Tool counts work
    expect(state.aggregate.totalInputTokens).toBe(0); // BUG: Should show current usage
    expect(state.aggregate.totalOutputTokens).toBe(0); // BUG: Should show current usage
  });

  it('MIXED STATE: aggregate includes tokens from completed but not active sessions', () => {
    // ARRANGE: One completed session with tokens, one active without
    fleetMonitor.registerSession('completed-1', '/workspace/test');
    fleetMonitor.updateSessionStatus('completed-1', 'running');
    fleetMonitor.updateTokens('completed-1', 2000, 1000);
    fleetMonitor.updateSessionStatus('completed-1', 'completed');

    fleetMonitor.registerSession('active-1', '/workspace/test');
    fleetMonitor.updateSessionStatus('active-1', 'running');
    fleetMonitor.incrementToolCount('active-1');
    // NOTE: No updateTokens() call because SDK doesn't provide them during streaming

    // ACT: Get fleet state
    const state = fleetMonitor.getFleetState();

    // ASSERT: Only completed session contributes to token totals
    expect(state.aggregate.totalSessions).toBe(2);
    expect(state.aggregate.activeSessions).toBe(1);
    expect(state.aggregate.totalInputTokens).toBe(2000); // Only from completed session
    expect(state.aggregate.totalOutputTokens).toBe(1000); // Only from completed session

    // Active session still shows 0 tokens (the bug)
    const activeDetail = fleetMonitor.getSessionDetail('active-1');
    expect(activeDetail?.status).toBe('running');
    expect(activeDetail?.inputTokens).toBe(0); // BUG
    expect(activeDetail?.outputTokens).toBe(0); // BUG
  });

  it('FIX: updateSessionTokens sets absolute token values correctly', () => {
    const sessionId = 'fix-session-1';
    fleetMonitor.registerSession(sessionId, '/workspace/test');
    fleetMonitor.updateSessionStatus(sessionId, 'running');

    // First call: set initial token counts
    fleetMonitor.updateSessionTokens(sessionId, 1000, 500);
    const detail1 = fleetMonitor.getSessionDetail(sessionId);
    expect(detail1?.inputTokens).toBe(1000);
    expect(detail1?.outputTokens).toBe(500);

    // Second call with larger counts (cumulative): should SET, not add
    fleetMonitor.updateSessionTokens(sessionId, 2500, 1200);
    const detail2 = fleetMonitor.getSessionDetail(sessionId);
    expect(detail2?.inputTokens).toBe(2500); // SET to 2500, not 3500
    expect(detail2?.outputTokens).toBe(1200); // SET to 1200, not 1700
  });

  it('FIX: fleet aggregate reflects token counts from active sessions after updateSessionTokens', () => {
    fleetMonitor.registerSession('fleet-fix-1', '/workspace/test');
    fleetMonitor.updateSessionStatus('fleet-fix-1', 'running');
    fleetMonitor.updateSessionTokens('fleet-fix-1', 3000, 1500);

    fleetMonitor.registerSession('fleet-fix-2', '/workspace/test');
    fleetMonitor.updateSessionStatus('fleet-fix-2', 'running');
    fleetMonitor.updateSessionTokens('fleet-fix-2', 1000, 400);

    const state = fleetMonitor.getFleetState();
    expect(state.aggregate.activeSessions).toBe(2);
    expect(state.aggregate.totalInputTokens).toBe(4000);
    expect(state.aggregate.totalOutputTokens).toBe(1900);
  });
});
