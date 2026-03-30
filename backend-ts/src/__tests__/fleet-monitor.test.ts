import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fleetMonitor from '../fleet-monitor.js';
import * as database from '../database.js';

describe('Fleet Monitor', () => {
  beforeEach(() => {
    fleetMonitor._clearSessions();
  });

  describe('registerSession', () => {
    it('creates session entry with correct defaults', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail).toBeDefined();
      expect(detail?.sessionId).toBe('sess1');
      expect(detail?.workspace).toBe('/workspace/project1');
      expect(detail?.status).toBe('idle');
      expect(detail?.toolCount).toBe(0);
      expect(detail?.activeAgents).toBe(0);
      expect(detail?.inputTokens).toBe(0);
      expect(detail?.outputTokens).toBe(0);
      expect(detail?.label).toBe('');
      expect(detail?.filesTouched).toEqual([]);
    });

    it('does not overwrite existing session', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.setLabel('sess1', 'Test session');

      fleetMonitor.registerSession('sess1', '/workspace/project2');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.workspace).toBe('/workspace/project1');
      expect(detail?.label).toBe('Test session');
    });
  });

  describe('updateSessionStatus', () => {
    it('changes status', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.updateSessionStatus('sess1', 'running');

      const afterUpdate = fleetMonitor.getSessionDetail('sess1');
      expect(afterUpdate?.status).toBe('running');
    });

    it('does nothing for unknown session', () => {
      fleetMonitor.updateSessionStatus('unknown', 'running');
      const detail = fleetMonitor.getSessionDetail('unknown');
      expect(detail).toBeNull();
    });
  });

  describe('incrementToolCount', () => {
    it('bumps tool count', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.incrementToolCount('sess1');
      fleetMonitor.incrementToolCount('sess1');
      fleetMonitor.incrementToolCount('sess1');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.toolCount).toBe(3);
    });

    it('correctly counts beyond 128 tool calls (regression: no uint8 overflow)', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      // Simulate 200 tool calls — well beyond the 128 threshold reported in the bug
      for (let i = 0; i < 200; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.toolCount).toBe(200);
    });

    it('aggregate totalToolCalls reflects counts beyond 128', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.registerSession('sess2', '/workspace/project2');

      for (let i = 0; i < 130; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }
      for (let i = 0; i < 75; i++) {
        fleetMonitor.incrementToolCount('sess2');
      }

      const state = fleetMonitor.getFleetState();
      expect(state.aggregate.totalToolCalls).toBe(205);
    });
  });

  describe('incrementAgentCount and decrementAgentCount', () => {
    it('increments active agent count', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.incrementAgentCount('sess1');
      fleetMonitor.incrementAgentCount('sess1');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.activeAgents).toBe(2);
    });

    it('decrements active agent count', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.incrementAgentCount('sess1');
      fleetMonitor.incrementAgentCount('sess1');

      fleetMonitor.decrementAgentCount('sess1');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.activeAgents).toBe(1);
    });

    it('does not go below zero when decrementing', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.decrementAgentCount('sess1');
      fleetMonitor.decrementAgentCount('sess1');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.activeAgents).toBe(0);
    });
  });

  describe('updateTokens', () => {
    it('accumulates input and output tokens', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.updateTokens('sess1', 100, 50);
      fleetMonitor.updateTokens('sess1', 200, 150);

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.inputTokens).toBe(300);
      expect(detail?.outputTokens).toBe(200);
    });
  });

  describe('addFileTouched', () => {
    it('adds file to list', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.addFileTouched('sess1', '/workspace/project1/file1.ts');
      fleetMonitor.addFileTouched('sess1', '/workspace/project1/file2.ts');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.filesTouched).toEqual([
        '/workspace/project1/file1.ts',
        '/workspace/project1/file2.ts',
      ]);
    });

    it('does not add duplicates', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.addFileTouched('sess1', '/workspace/project1/file1.ts');
      fleetMonitor.addFileTouched('sess1', '/workspace/project1/file1.ts');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.filesTouched).toEqual(['/workspace/project1/file1.ts']);
    });
  });

  describe('setLabel', () => {
    it('sets label if not already set', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');

      fleetMonitor.setLabel('sess1', 'First user message');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.label).toBe('First user message');
    });

    it('does not overwrite existing label', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.setLabel('sess1', 'First message');

      fleetMonitor.setLabel('sess1', 'Second message');

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.label).toBe('First message');
    });
  });

  describe('getFleetState', () => {
    it('returns all sessions with aggregate stats', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      fleetMonitor.incrementToolCount('sess1');
      fleetMonitor.updateTokens('sess1', 100, 50);

      fleetMonitor.registerSession('sess2', '/workspace/project2');
      fleetMonitor.updateSessionStatus('sess2', 'completed');
      fleetMonitor.incrementToolCount('sess2');
      fleetMonitor.incrementToolCount('sess2');
      fleetMonitor.updateTokens('sess2', 200, 100);

      const state = fleetMonitor.getFleetState();

      expect(state.sessions).toHaveLength(2);
      expect(state.aggregate.totalSessions).toBe(2);
      expect(state.aggregate.activeSessions).toBe(1);
      expect(state.aggregate.totalToolCalls).toBe(3);
      expect(state.aggregate.totalInputTokens).toBe(300);
      expect(state.aggregate.totalOutputTokens).toBe(150);
    });

    it('returns empty state when no sessions', () => {
      const state = fleetMonitor.getFleetState();

      expect(state.sessions).toEqual([]);
      expect(state.aggregate.totalSessions).toBe(0);
      expect(state.aggregate.activeSessions).toBe(0);
      expect(state.aggregate.totalToolCalls).toBe(0);
      expect(state.aggregate.totalInputTokens).toBe(0);
      expect(state.aggregate.totalOutputTokens).toBe(0);
    });
  });

  describe('getSessionDetail', () => {
    it('returns null for unknown session', () => {
      const detail = fleetMonitor.getSessionDetail('unknown');
      expect(detail).toBeNull();
    });

    it('returns session info for known session', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail).toBeDefined();
      expect(detail?.sessionId).toBe('sess1');
    });
  });

  describe('markOrphanedSessions', () => {
    let upsertSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      upsertSpy = vi.spyOn(database, 'upsertFleetSession').mockImplementation(() => {});
    });

    afterEach(() => {
      upsertSpy.mockRestore();
    });

    it('marks running sessions as failed', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.status).toBe('failed');
    });

    it('marks idle sessions as failed', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      // status is 'idle' by default after registerSession
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.status).toBe('failed');
    });

    it('does not change sessions with failed status', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'failed');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      expect(upsertSpy).not.toHaveBeenCalled();
      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.status).toBe('failed');
    });

    it('does not change sessions with completed status', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'completed');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('does not change sessions with cancelled status', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'cancelled');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('appends (orphaned on restart) suffix to label', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.setLabel('sess1', 'My task');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.label).toBe('My task (orphaned on restart)');
    });

    it('does not duplicate the suffix when called twice on the same session', () => {
      // Call markOrphanedSessions once — session becomes failed with suffix
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      fleetMonitor.markOrphanedSessions();

      // Manually reset status back to idle to allow a second call to process it
      // (simulating a case where a label with the suffix is already present)
      fleetMonitor.updateSessionStatus('sess1', 'idle');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      // Should not have doubled suffix
      expect(detail?.label).toBe('(orphaned on restart)');
      expect(detail?.label).not.toBe('(orphaned on restart) (orphaned on restart)');
    });

    it('sets label to (orphaned on restart) when session has no label', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      // label is '' by default
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.label).toBe('(orphaned on restart)');
    });

    it('calculates a positive durationMs', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      upsertSpy.mockClear();

      const before = Date.now();
      fleetMonitor.markOrphanedSessions();
      const after = Date.now();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.durationMs).toBeGreaterThanOrEqual(0);
      expect(detail?.durationMs).toBeLessThanOrEqual(after - new Date(detail?.startedAt ?? '').getTime() + 10);
    });

    it('durationMs increases with session age', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // Backdate startedAt by 5 seconds
      const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', fiveSecondsAgo);
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.durationMs).toBeGreaterThanOrEqual(5000);
    });

    it('sets lastActivity to a recent ISO timestamp', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      upsertSpy.mockClear();

      const before = Date.now();
      fleetMonitor.markOrphanedSessions();
      const after = Date.now();

      const detail = fleetMonitor.getSessionDetail('sess1');
      const lastActivityTs = new Date(detail?.lastActivity ?? '').getTime();
      expect(lastActivityTs).toBeGreaterThanOrEqual(before);
      expect(lastActivityTs).toBeLessThanOrEqual(after);
    });

    it('calls upsertFleetSession for each orphaned session', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      fleetMonitor.registerSession('sess2', '/workspace/project2');
      // sess2 stays idle
      fleetMonitor.registerSession('sess3', '/workspace/project3');
      fleetMonitor.updateSessionStatus('sess3', 'completed');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      // sess1 (running) and sess2 (idle) are orphaned; sess3 (completed) is not
      expect(upsertSpy).toHaveBeenCalledTimes(2);
    });

    it('does nothing when there are no sessions', () => {
      // sessions are already cleared by beforeEach
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('does nothing when all sessions are in terminal states', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'completed');
      fleetMonitor.registerSession('sess2', '/workspace/project2');
      fleetMonitor.updateSessionStatus('sess2', 'failed');
      fleetMonitor.registerSession('sess3', '/workspace/project3');
      fleetMonitor.updateSessionStatus('sess3', 'cancelled');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('returns void (no return value)', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');
      upsertSpy.mockClear();

      const result = fleetMonitor.markOrphanedSessions();

      expect(result).toBeUndefined();
    });

    it('handles mixed statuses — only orphans running and idle sessions', () => {
      fleetMonitor.registerSession('sess-running', '/workspace/a');
      fleetMonitor.updateSessionStatus('sess-running', 'running');

      fleetMonitor.registerSession('sess-idle', '/workspace/b');
      // idle by default

      fleetMonitor.registerSession('sess-completed', '/workspace/c');
      fleetMonitor.updateSessionStatus('sess-completed', 'completed');

      fleetMonitor.registerSession('sess-failed', '/workspace/d');
      fleetMonitor.updateSessionStatus('sess-failed', 'failed');

      fleetMonitor.registerSession('sess-cancelled', '/workspace/e');
      fleetMonitor.updateSessionStatus('sess-cancelled', 'cancelled');
      upsertSpy.mockClear();

      fleetMonitor.markOrphanedSessions();

      expect(fleetMonitor.getSessionDetail('sess-running')?.status).toBe('failed');
      expect(fleetMonitor.getSessionDetail('sess-idle')?.status).toBe('failed');
      expect(fleetMonitor.getSessionDetail('sess-completed')?.status).toBe('completed');
      expect(fleetMonitor.getSessionDetail('sess-failed')?.status).toBe('failed');
      expect(fleetMonitor.getSessionDetail('sess-cancelled')?.status).toBe('cancelled');
      expect(upsertSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('emitFleetUpdate throttling', () => {
    it('throttles emissions to max 1 per second', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      fleetMonitor.registerSession('sess1', '/workspace/project1');

      // Multiple rapid updates
      fleetMonitor.incrementToolCount('sess1');
      fleetMonitor.incrementToolCount('sess1');
      fleetMonitor.incrementToolCount('sess1');

      // Should only emit once due to throttling
      expect(mockIo.to).toHaveBeenCalledTimes(1);
      expect(mockIo.to).toHaveBeenCalledWith('fleet_monitor');
      expect(mockIo.emit).toHaveBeenCalledTimes(1);
      expect(mockIo.emit).toHaveBeenCalledWith('fleet_update', expect.any(Object));
    });
  });

  describe('Stuck Session Detection', () => {
    it('does not flag session below tool threshold', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 29 tools (below threshold of 30)
      for (let i = 0; i < 29; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // Backdate to >2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 130_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', twoMinutesAgo);

      // Trigger detection
      fleetMonitor._detectStuckSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.stuckDetectedAt).toBeUndefined();
    });

    it('does not flag session with files touched', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 35 tools
      for (let i = 0; i < 35; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // Touch a file
      fleetMonitor.addFileTouched('sess1', '/workspace/project1/file.ts');

      // Backdate to >2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 130_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', twoMinutesAgo);

      // Trigger detection
      fleetMonitor._detectStuckSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.stuckDetectedAt).toBeUndefined();
    });

    it('does not flag session under duration threshold', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 35 tools
      for (let i = 0; i < 35; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // Session is only 60s old (below 120s threshold)
      const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', sixtySecondsAgo);

      // Trigger detection
      fleetMonitor._detectStuckSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.stuckDetectedAt).toBeUndefined();
    });

    it('flags session meeting all criteria', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 35 tools (above threshold)
      for (let i = 0; i < 35; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // No files touched (default)
      // Backdate to >2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 130_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', twoMinutesAgo);

      // Trigger detection
      fleetMonitor._detectStuckSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.stuckDetectedAt).toBeDefined();
      expect(mockIo.to).toHaveBeenCalledWith('fleet_monitor');
      expect(mockIo.emit).toHaveBeenCalledWith('session_stuck', expect.objectContaining({
        sessionId: 'sess1',
        toolCount: 35,
        filesTouched: 0,
      }));
    });

    it('only alerts once', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      const callback = vi.fn();
      fleetMonitor.onSessionStuck(callback);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 35 tools
      for (let i = 0; i < 35; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // Backdate to >2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 130_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', twoMinutesAgo);

      // Trigger detection twice
      fleetMonitor._detectStuckSessions();
      fleetMonitor._detectStuckSessions();

      // Callback should only be called once
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not flag completed sessions', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 35 tools
      for (let i = 0; i < 35; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // Backdate to >2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 130_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', twoMinutesAgo);

      // Mark as completed before detection
      fleetMonitor.updateSessionStatus('sess1', 'completed');

      // Trigger detection
      fleetMonitor._detectStuckSessions();

      const detail = fleetMonitor.getSessionDetail('sess1');
      expect(detail?.stuckDetectedAt).toBeUndefined();
    });

    it('calls registered callback with session info', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      const callback = vi.fn();
      fleetMonitor.onSessionStuck(callback);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 35 tools
      for (let i = 0; i < 35; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // Backdate to >2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 130_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', twoMinutesAgo);

      // Trigger detection
      fleetMonitor._detectStuckSessions();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('sess1', expect.objectContaining({
        sessionId: 'sess1',
        toolCount: 35,
        filesTouched: [],
        status: 'running',
        stuckDetectedAt: expect.any(Number),
      }));
    });

    it('emits session_stuck socket event', () => {
      const mockIo = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      fleetMonitor.setIOInstance(mockIo as any);

      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      // 35 tools
      for (let i = 0; i < 35; i++) {
        fleetMonitor.incrementToolCount('sess1');
      }

      // Backdate to >2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 130_000).toISOString();
      fleetMonitor._setSessionStartedAt('sess1', twoMinutesAgo);

      // Trigger detection
      fleetMonitor._detectStuckSessions();

      expect(mockIo.to).toHaveBeenCalledWith('fleet_monitor');
      expect(mockIo.emit).toHaveBeenCalledWith('session_stuck', {
        sessionId: 'sess1',
        toolCount: 35,
        filesTouched: 0,
        durationMs: expect.any(Number),
      });
    });
  });
});

  describe('Session Pruner', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      fleetMonitor._clearSessions(); // Clear after fake timers so the pruner state is reset properly
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('removes a terminal session older than 1 hour from memory', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'completed');

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
      fleetMonitor._setSessionLastActivity('sess1', oneHourAgo);

      fleetMonitor.startPruner();
      vi.advanceTimersByTime(10 * 60 * 1000); // advance by PRUNE_INTERVAL_MS

      expect(fleetMonitor.getSessionDetail('sess1')).toBeNull();
    });

    it('does NOT remove a terminal session younger than 1 hour', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'completed');

      // lastActivity is now (just registered and completed), well under 1 hour
      fleetMonitor.startPruner();
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(fleetMonitor.getSessionDetail('sess1')).not.toBeNull();
    });

    it('does NOT remove a running session older than 1 hour', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'running');

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
      fleetMonitor._setSessionLastActivity('sess1', oneHourAgo);

      fleetMonitor.startPruner();
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(fleetMonitor.getSessionDetail('sess1')).not.toBeNull();
    });

    it('does NOT remove an idle session older than 1 hour', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      // status remains 'idle'

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
      fleetMonitor._setSessionLastActivity('sess1', oneHourAgo);

      fleetMonitor.startPruner();
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(fleetMonitor.getSessionDetail('sess1')).not.toBeNull();
    });
    it('prunes old completed sessions', () => {
      fleetMonitor.registerSession('s1', '/workspace/a');
      fleetMonitor.updateSessionStatus('s1', 'completed');
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
      fleetMonitor._setSessionLastActivity('s1', oneHourAgo);

      fleetMonitor.startPruner();
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(fleetMonitor.getSessionDetail('s1')).toBeNull();
    });

    it('prunes old failed sessions', () => {
      fleetMonitor.registerSession('s2', '/workspace/b');
      fleetMonitor.updateSessionStatus('s2', 'failed');
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
      fleetMonitor._setSessionLastActivity('s2', oneHourAgo);

      fleetMonitor.startPruner();
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(fleetMonitor.getSessionDetail('s2')).toBeNull();
    });

    it('prunes old cancelled sessions', () => {
      fleetMonitor.registerSession('s3', '/workspace/c');
      fleetMonitor.updateSessionStatus('s3', 'cancelled');
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
      fleetMonitor._setSessionLastActivity('s3', oneHourAgo);

      fleetMonitor.startPruner();
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(fleetMonitor.getSessionDetail('s3')).toBeNull();
    });

    it('_clearSessions() stops the pruner interval', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      fleetMonitor.startPruner();
      fleetMonitor._clearSessions(); // internally calls stopPruner()

      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });

    it('pruner fires on each PRUNE_INTERVAL_MS tick', () => {
      fleetMonitor.registerSession('sess1', '/workspace/project1');
      fleetMonitor.updateSessionStatus('sess1', 'completed');

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
      fleetMonitor._setSessionLastActivity('sess1', oneHourAgo);

      fleetMonitor.startPruner();

      // Session should still be present before the interval fires
      expect(fleetMonitor.getSessionDetail('sess1')).not.toBeNull();

      vi.advanceTimersByTime(10 * 60 * 1000); // one full interval

      expect(fleetMonitor.getSessionDetail('sess1')).toBeNull();
    });
  });
