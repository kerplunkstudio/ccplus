import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fleetMonitor from '../fleet-monitor.js';

describe('cancel_session zombie fix', () => {
  beforeEach(() => {
    fleetMonitor._clearSessions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    fleetMonitor._clearSessions();
    vi.useRealTimers();
  });

  describe('updateSessionStatus with cancelled', () => {
    it('marks a running zombie session as cancelled', () => {
      fleetMonitor.registerSession('zombie-sess', '/workspace/proj');
      fleetMonitor.updateSessionStatus('zombie-sess', 'running');

      fleetMonitor.updateSessionStatus('zombie-sess', 'cancelled');

      const detail = fleetMonitor.getSessionDetail('zombie-sess');
      expect(detail?.status).toBe('cancelled');
    });

    it('marks cancelled regardless of tool count', () => {
      fleetMonitor.registerSession('zombie-sess', '/workspace/proj');
      fleetMonitor.updateSessionStatus('zombie-sess', 'running');
      // No tools called - zombie with 0 tool_count

      fleetMonitor.updateSessionStatus('zombie-sess', 'cancelled');

      const detail = fleetMonitor.getSessionDetail('zombie-sess');
      expect(detail?.status).toBe('cancelled');
      expect(detail?.toolCount).toBe(0);
    });
  });

  describe('zombie reaper', () => {
    it('marks running sessions with 0 tools and old activity as failed', () => {
      fleetMonitor.registerSession('zombie-sess', '/workspace/proj');
      fleetMonitor.updateSessionStatus('zombie-sess', 'running');
      // Simulate lastActivity 6 minutes ago
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      fleetMonitor._setSessionLastActivity('zombie-sess', sixMinutesAgo);

      fleetMonitor.startZombieReaper();
      // Advance time by 1 minute to trigger the reaper
      vi.advanceTimersByTime(60_000);

      const detail = fleetMonitor.getSessionDetail('zombie-sess');
      expect(detail?.status).toBe('failed');
    });

    it('does not reap sessions with tool activity', () => {
      fleetMonitor.registerSession('active-sess', '/workspace/proj');
      fleetMonitor.updateSessionStatus('active-sess', 'running');
      fleetMonitor.incrementToolCount('active-sess');
      // Even if lastActivity is old, tool_count > 0 should protect it
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      fleetMonitor._setSessionLastActivity('active-sess', sixMinutesAgo);

      fleetMonitor.startZombieReaper();
      vi.advanceTimersByTime(60_000);

      const detail = fleetMonitor.getSessionDetail('active-sess');
      expect(detail?.status).toBe('running');
    });

    it('does not reap sessions with recent activity', () => {
      fleetMonitor.registerSession('recent-sess', '/workspace/proj');
      fleetMonitor.updateSessionStatus('recent-sess', 'running');
      // lastActivity is now (recent)

      fleetMonitor.startZombieReaper();
      vi.advanceTimersByTime(60_000);

      const detail = fleetMonitor.getSessionDetail('recent-sess');
      expect(detail?.status).toBe('running');
    });

    it('does not reap already-completed sessions', () => {
      fleetMonitor.registerSession('done-sess', '/workspace/proj');
      fleetMonitor.updateSessionStatus('done-sess', 'completed');
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      fleetMonitor._setSessionLastActivity('done-sess', sixMinutesAgo);

      fleetMonitor.startZombieReaper();
      vi.advanceTimersByTime(60_000);

      const detail = fleetMonitor.getSessionDetail('done-sess');
      expect(detail?.status).toBe('completed');
    });
  });
});
