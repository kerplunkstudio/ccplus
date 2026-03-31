import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startTickLoop,
  stopTickLoop,
  sleepTicks,
  getSleepRemaining,
  isBriefMode,
  resetBriefMode,
  getTickState,
  _resetTickState,
  buildTickMessage,
} from '../captain-tick.js';

describe('captain-tick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetTickState();
  });

  afterEach(() => {
    stopTickLoop();
    vi.useRealTimers();
  });

  describe('startTickLoop / stopTickLoop', () => {
    it('creates interval that fires tick function', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      vi.advanceTimersByTime(60000);
      expect(sendTickMessage).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60000);
      expect(sendTickMessage).toHaveBeenCalledTimes(2);
    });

    it('stopTickLoop clears interval', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      stopTickLoop();
      vi.advanceTimersByTime(120000);
      expect(sendTickMessage).not.toHaveBeenCalled();
    });
  });

  describe('tick guards', () => {
    it('skips tick when Captain not alive', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => false,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      vi.advanceTimersByTime(60000);
      expect(sendTickMessage).not.toHaveBeenCalled();
    });

    it('skips tick when Captain not idle (active query)', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => false,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      vi.advanceTimersByTime(60000);
      expect(sendTickMessage).not.toHaveBeenCalled();
    });

    it('skips tick when disabled', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => false,
      });

      vi.advanceTimersByTime(60000);
      expect(sendTickMessage).not.toHaveBeenCalled();
    });
  });

  describe('sleep mechanism', () => {
    it('sleepTicks suppresses ticks and decrements', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      sleepTicks(3);
      expect(getSleepRemaining()).toBe(3);

      // Ticks 1-3 should be suppressed
      vi.advanceTimersByTime(60000);
      expect(sendTickMessage).not.toHaveBeenCalled();
      expect(getSleepRemaining()).toBe(2);

      vi.advanceTimersByTime(60000);
      expect(getSleepRemaining()).toBe(1);

      vi.advanceTimersByTime(60000);
      expect(getSleepRemaining()).toBe(0);

      // Tick 4 should fire
      vi.advanceTimersByTime(60000);
      expect(sendTickMessage).toHaveBeenCalledTimes(1);
    });

    it('multiple sleepTicks calls reset the counter (last write wins)', () => {
      sleepTicks(10);
      expect(getSleepRemaining()).toBe(10);
      sleepTicks(2);
      expect(getSleepRemaining()).toBe(2);
    });

    it('sleepTicks returns correct sleep info', () => {
      // Advance 2 ticks first to set tickNumber
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      vi.advanceTimersByTime(120000); // 2 ticks fire
      const result = sleepTicks(5);
      expect(result.sleepUntilTick).toBe(getTickState().tickNumber + 5);
    });
  });

  describe('brief mode', () => {
    it('sets briefMode true during tick, can be reset', () => {
      expect(isBriefMode()).toBe(false);

      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      vi.advanceTimersByTime(60000);
      expect(isBriefMode()).toBe(true);

      resetBriefMode();
      expect(isBriefMode()).toBe(false);
    });
  });

  describe('buildTickMessage', () => {
    it('produces correct XML format', () => {
      const msg = buildTickMessage({
        timestamp: '2026-03-31T10:00:00Z',
        uptimeMs: 3600000,
        terminalFocused: true,
        fleetSummary: { activeSessions: 3, pendingSessions: 1, recentlyCompleted: 2, stuckSessions: 0 },
        tickNumber: 42,
      });

      expect(msg).toContain('<tick');
      expect(msg).toContain('number="42"');
      expect(msg).toContain('terminal_focused="true"');
      expect(msg).toContain('active="3"');
      expect(msg).toContain('pending="1"');
      expect(msg).toContain('recently_completed="2"');
      expect(msg).toContain('stuck="0"');
      expect(msg).toContain('</tick>');
    });
  });

  describe('tick state', () => {
    it('increments tickNumber on each fired tick', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      vi.advanceTimersByTime(180000); // 3 ticks
      expect(getTickState().tickNumber).toBe(3);
    });

    it('updates lastTickAt on each fired tick', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60000,
        isTickEnabled: () => true,
      });

      expect(getTickState().lastTickAt).toBeNull();
      vi.advanceTimersByTime(60000);
      expect(getTickState().lastTickAt).not.toBeNull();
    });

    it('_resetTickState clears everything', () => {
      sleepTicks(10);
      _resetTickState();
      expect(getSleepRemaining()).toBe(0);
      expect(getTickState().tickNumber).toBe(0);
      expect(isBriefMode()).toBe(false);
    });
  });
});
