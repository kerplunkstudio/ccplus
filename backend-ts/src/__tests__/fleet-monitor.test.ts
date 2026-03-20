import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fleetMonitor from '../fleet-monitor.js';

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
});
