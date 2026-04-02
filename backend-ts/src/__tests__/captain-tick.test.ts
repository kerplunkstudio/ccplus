import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startTickLoop,
  stopTickLoop,
  sleepTicks,
  getSleepRemaining,
  isBriefMode,
  activateBriefMode,
  resetBriefMode,
  shouldSuppressBriefOutput,
  sendTickMessage,
  getTickState,
  _resetTickState,
  buildTickMessage,
  notifyRateLimit,
  resetBackoff,
  getBackoffState,
  getCaptainCircuitBreakerState,
  resetCaptainCircuitBreaker,
} from '../captain-tick.js';

// Mock logger to suppress output during tests
vi.mock('../logger.js', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('captain-tick: tick loop', () => {
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

  describe('brief mode (tick loop integration)', () => {
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

describe('captain-tick: brief mode state', () => {
  beforeEach(() => {
    // Always reset brief mode before each test to prevent state leakage
    resetBriefMode();
  });

  it('starts with brief mode inactive', () => {
    expect(isBriefMode()).toBe(false);
  });

  it('activateBriefMode() sets brief mode to true', () => {
    activateBriefMode();
    expect(isBriefMode()).toBe(true);
  });

  it('resetBriefMode() sets brief mode to false', () => {
    activateBriefMode();
    resetBriefMode();
    expect(isBriefMode()).toBe(false);
  });

  it('resetBriefMode() is idempotent when already inactive', () => {
    expect(isBriefMode()).toBe(false);
    resetBriefMode(); // Should not throw
    expect(isBriefMode()).toBe(false);
  });

  it('multiple activations do not stack — one reset clears it', () => {
    activateBriefMode();
    activateBriefMode();
    resetBriefMode();
    expect(isBriefMode()).toBe(false);
  });
});

describe('captain-tick: shouldSuppressBriefOutput()', () => {
  beforeEach(() => {
    resetBriefMode();
  });

  it('returns false when brief mode is inactive (never suppresses user messages)', () => {
    expect(isBriefMode()).toBe(false);
    expect(shouldSuppressBriefOutput('Some idle text')).toBe(false);
    expect(shouldSuppressBriefOutput('')).toBe(false);
    expect(shouldSuppressBriefOutput('standing by')).toBe(false);
  });

  it('returns true for non-actionable text when brief mode is active', () => {
    activateBriefMode();
    expect(shouldSuppressBriefOutput('All looks good, nothing to do.')).toBe(true);
    expect(shouldSuppressBriefOutput('Standing by for instructions.')).toBe(true);
    expect(shouldSuppressBriefOutput('Fleet is healthy.')).toBe(true);
  });

  it('returns false for actionable text even when brief mode is active', () => {
    activateBriefMode();
    // Each actionable pattern should pass through
    expect(shouldSuppressBriefOutput('I am calling start_session now')).toBe(false);
    expect(shouldSuppressBriefOutput('Starting session for the user')).toBe(false);
    expect(shouldSuppressBriefOutput('Session started: feat-auth-ts')).toBe(false);
    expect(shouldSuppressBriefOutput('Launching three parallel sessions')).toBe(false);
    expect(shouldSuppressBriefOutput('[FLEET] Session completed')).toBe(false);
    expect(shouldSuppressBriefOutput('Error: session failed to start')).toBe(false);
    expect(shouldSuppressBriefOutput('Failed: could not connect')).toBe(false);
    expect(shouldSuppressBriefOutput('Warning: session is stuck')).toBe(false);
    expect(shouldSuppressBriefOutput('Session completed successfully')).toBe(false);
    expect(shouldSuppressBriefOutput('Session cancelled by user')).toBe(false);
  });

  it('is case-insensitive for actionable pattern matching', () => {
    activateBriefMode();
    expect(shouldSuppressBriefOutput('START_SESSION called')).toBe(false);
    expect(shouldSuppressBriefOutput('ERROR: something went wrong')).toBe(false);
    expect(shouldSuppressBriefOutput('COMPLETED task')).toBe(false);
  });
});

describe('captain-tick: sendTickMessage()', () => {
  beforeEach(() => {
    resetBriefMode();
  });

  it('activates brief mode before sending, cleanup resets it', () => {
    const mockSend = vi.fn();
    expect(isBriefMode()).toBe(false);

    const cleanup = sendTickMessage('do a fleet check', mockSend);

    // Brief mode is active after sendTickMessage
    expect(isBriefMode()).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith('do a fleet check', 'fleet', 'tick');

    // After cleanup, brief mode is reset
    cleanup();
    expect(isBriefMode()).toBe(false);
  });

  it('sends message with source=fleet and sourceId=tick', () => {
    const mockSend = vi.fn();
    const cleanup = sendTickMessage('scheduled check', mockSend);
    cleanup();

    expect(mockSend).toHaveBeenCalledWith('scheduled check', 'fleet', 'tick');
  });

  it('resets brief mode immediately on send failure', () => {
    const mockSend = vi.fn(() => {
      throw new Error('Captain not active');
    });

    expect(() => sendTickMessage('check', mockSend)).toThrow('Captain not active');

    // Brief mode must be reset even on error — the crucial invariant
    expect(isBriefMode()).toBe(false);
  });

  it('REGRESSION: brief mode does not persist after tick completes', () => {
    // This test documents the bug that would exist if cleanup were never called.
    // After a tick fires and its cleanup runs, user messages must NOT be suppressed.
    const mockSend = vi.fn();

    // Simulate tick firing and completing
    const cleanup = sendTickMessage('periodic check', mockSend);
    expect(isBriefMode()).toBe(true); // active during tick
    cleanup();
    expect(isBriefMode()).toBe(false); // reset after tick

    // Now simulate a Telegram user message arriving after the tick
    // In captain.ts, sendCaptainMessage with source != 'fleet'+'tick' calls resetBriefMode()
    // and brief mode is already false, so the user message is NOT suppressed
    expect(shouldSuppressBriefOutput('What is the fleet status?')).toBe(false);
  });

  it('REGRESSION: user message after tick resets brief mode even if cleanup not called', () => {
    // This simulates captain.ts calling resetBriefMode() in sendCaptainMessage
    // for non-tick sources. Even if a tick activated brief mode and cleanup was
    // somehow skipped, the next user message must clear it.
    activateBriefMode();
    expect(isBriefMode()).toBe(true);

    // Simulate what captain.ts sendCaptainMessage does for web/telegram/discord/api
    resetBriefMode();

    expect(isBriefMode()).toBe(false);
    expect(shouldSuppressBriefOutput('Any user message')).toBe(false);
  });
});

describe('captain-tick: exponential backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetTickState();
  });

  afterEach(() => {
    stopTickLoop();
    vi.useRealTimers();
  });

  describe('notifyRateLimit()', () => {
    it('starts with multiplier 1 and rateLimitedUntil 0', () => {
      const state = getBackoffState();
      expect(state.multiplier).toBe(1);
      expect(state.rateLimitedUntil).toBe(0);
    });

    it('doubles the multiplier on first call', () => {
      notifyRateLimit();
      expect(getBackoffState().multiplier).toBe(2);
    });

    it('doubles the multiplier on each successive call', () => {
      notifyRateLimit();
      notifyRateLimit();
      expect(getBackoffState().multiplier).toBe(4);
      notifyRateLimit();
      expect(getBackoffState().multiplier).toBe(8);
    });

    it('caps multiplier at MAX_BACKOFF_MS / baseInterval (10 min / 60s = 10)', () => {
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage: vi.fn(),
        sendCaptainMessage: vi.fn(),
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60_000,
        isTickEnabled: () => true,
      });

      // 10 doublings: 1 -> 2 -> 4 -> 8 -> 10 (capped)
      for (let i = 0; i < 10; i++) notifyRateLimit();
      expect(getBackoffState().multiplier).toBe(10);
    });

    it('sets rateLimitedUntil when retryAfterMs is provided', () => {
      const before = Date.now();
      notifyRateLimit(5000);
      const state = getBackoffState();
      expect(state.rateLimitedUntil).toBeGreaterThanOrEqual(before + 5000);
    });

    it('does not set rateLimitedUntil when retryAfterMs is 0', () => {
      notifyRateLimit(0);
      expect(getBackoffState().rateLimitedUntil).toBe(0);
    });

    it('does not set rateLimitedUntil when retryAfterMs is undefined', () => {
      notifyRateLimit();
      expect(getBackoffState().rateLimitedUntil).toBe(0);
    });
  });

  describe('resetBackoff()', () => {
    it('resets multiplier to 1', () => {
      notifyRateLimit();
      notifyRateLimit();
      expect(getBackoffState().multiplier).toBe(4);
      resetBackoff();
      expect(getBackoffState().multiplier).toBe(1);
    });

    it('resets rateLimitedUntil to 0', () => {
      notifyRateLimit(10000);
      expect(getBackoffState().rateLimitedUntil).toBeGreaterThan(0);
      resetBackoff();
      expect(getBackoffState().rateLimitedUntil).toBe(0);
    });

    it('is idempotent when already at defaults', () => {
      resetBackoff();
      const state = getBackoffState();
      expect(state.multiplier).toBe(1);
      expect(state.rateLimitedUntil).toBe(0);
    });
  });

  describe('getBackoffState()', () => {
    it('returns a copy — mutations do not affect internal state', () => {
      const state = getBackoffState();
      state.multiplier = 999;
      expect(getBackoffState().multiplier).toBe(1);
    });
  });

  describe('tick skips when rateLimitedUntil is in the future', () => {
    it('suppresses tick while rate limited', () => {
      const sendTickMessage = vi.fn();
      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        sendCaptainMessage: vi.fn(),
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60_000,
        isTickEnabled: () => true,
      });

      // Rate limited for 5 minutes
      notifyRateLimit(300_000);

      // Advance past one base interval
      vi.advanceTimersByTime(60_000);
      expect(sendTickMessage).not.toHaveBeenCalled();
    });

    it('fires tick once rate limit clears (rateLimitedUntil in the past)', () => {
      const sendTickMessage = vi.fn();

      // Set a rate limit that expires 30 seconds from "now" (fake time 0)
      // Base interval = 60s, multiplier after one notifyRateLimit = 2 → interval = 120s
      notifyRateLimit(30_000);

      startTickLoop({
        isCaptainAlive: () => true,
        isCaptainIdle: () => true,
        sendTickMessage,
        sendCaptainMessage: vi.fn(),
        getFleetState: () => ({ totalSessions: 0, activeSessions: 0, pendingSessions: 0, recentlyCompleted: 0, stuckSessions: 0, sessions: [] }),
        isTerminalFocused: () => false,
        getTickIntervalMs: () => 60_000,
        isTickEnabled: () => true,
      });

      // After 120s (first doubled interval fires), rateLimitedUntil (30s) has passed
      vi.advanceTimersByTime(120_000);
      expect(sendTickMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('_resetTickState() resets backoff', () => {
    it('resets both multiplier and rateLimitedUntil', () => {
      notifyRateLimit(99999);
      notifyRateLimit();
      _resetTickState();
      const state = getBackoffState();
      expect(state.multiplier).toBe(1);
      expect(state.rateLimitedUntil).toBe(0);
    });
  });
});

describe('captain-tick: circuit breaker', () => {
  const DEFAULT_DEPS = {
    isCaptainAlive: () => true,
    isCaptainIdle: () => true,
    sendCaptainMessage: vi.fn(),
    getFleetState: () => ({
      totalSessions: 0,
      activeSessions: 0,
      pendingSessions: 0,
      recentlyCompleted: 0,
      stuckSessions: 0,
      sessions: [],
    }),
    isTerminalFocused: () => false,
    getTickIntervalMs: () => 60_000,
    isTickEnabled: () => true,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    _resetTickState();
  });

  afterEach(() => {
    stopTickLoop();
    vi.useRealTimers();
  });

  it('starts closed (zero failures)', () => {
    const state = getCaptainCircuitBreakerState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.circuitOpenUntil).toBe(0);
  });

  it('getCaptainCircuitBreakerState() returns a copy — mutations do not affect internal state', () => {
    const state = getCaptainCircuitBreakerState();
    state.consecutiveFailures = 999;
    expect(getCaptainCircuitBreakerState().consecutiveFailures).toBe(0);
  });

  it('_resetTickState() resets circuit breaker', () => {
    resetCaptainCircuitBreaker();
    _resetTickState();
    const state = getCaptainCircuitBreakerState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.circuitOpenUntil).toBe(0);
  });

  it('resetCaptainCircuitBreaker() closes the circuit immediately', () => {
    // Manually open the circuit by forcing 5 failures via a throwing sendTickMessage
    const throwingDeps = {
      ...DEFAULT_DEPS,
      sendTickMessage: vi.fn(() => {
        throw new Error('Simulated SDK crash');
      }),
    };

    startTickLoop(throwingDeps);

    // Fire 5 ticks — each should increment failures (threshold = 5)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60_000);
    }

    // Circuit should now be open
    expect(getCaptainCircuitBreakerState().consecutiveFailures).toBeGreaterThanOrEqual(5);

    // Now reset it
    resetCaptainCircuitBreaker();
    const state = getCaptainCircuitBreakerState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.circuitOpenUntil).toBe(0);
  });

  it('records a failure when tick throws a non-rate-limit error', () => {
    const throwingDeps = {
      ...DEFAULT_DEPS,
      sendTickMessage: vi.fn(() => {
        throw new Error('Network error');
      }),
    };

    startTickLoop(throwingDeps);
    vi.advanceTimersByTime(60_000); // one failing tick

    expect(getCaptainCircuitBreakerState().consecutiveFailures).toBe(1);
  });

  it('circuit opens after 5 consecutive failures (threshold=5)', () => {
    const throwingDeps = {
      ...DEFAULT_DEPS,
      sendTickMessage: vi.fn(() => {
        throw new Error('Repeated crash');
      }),
    };

    startTickLoop(throwingDeps);

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60_000);
    }

    const state = getCaptainCircuitBreakerState();
    expect(state.consecutiveFailures).toBeGreaterThanOrEqual(5);
    expect(state.circuitOpenUntil).toBeGreaterThan(0);
  });

  it('suppresses ticks while circuit is open', () => {
    const sendTickMessage = vi.fn(() => {
      throw new Error('crash');
    });

    startTickLoop({ ...DEFAULT_DEPS, sendTickMessage });

    // Trip the circuit (5 failures)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60_000);
    }

    const callsAfterTrip = sendTickMessage.mock.calls.length;

    // Advance more — ticks should be blocked now
    vi.advanceTimersByTime(60_000);
    expect(sendTickMessage.mock.calls.length).toBe(callsAfterTrip);
  });

  it('auto-resets after cooldown and allows tick to fire again', () => {
    const errors = { throw: true };
    const sendTickMessage = vi.fn(() => {
      if (errors.throw) throw new Error('crash');
    });

    startTickLoop({ ...DEFAULT_DEPS, sendTickMessage });

    // Trip the circuit
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60_000);
    }

    const callsAtTrip = sendTickMessage.mock.calls.length;

    // Stop throwing — simulate recovery
    errors.throw = false;

    // Advance past 2-minute cooldown
    vi.advanceTimersByTime(120_001);

    // One more tick interval should allow a tick through
    vi.advanceTimersByTime(60_000);

    expect(sendTickMessage.mock.calls.length).toBeGreaterThan(callsAtTrip);
  });

  it('resets failure count on successful tick', () => {
    let shouldThrow = true;
    const sendTickMessage = vi.fn(() => {
      if (shouldThrow) throw new Error('temporary failure');
    });

    startTickLoop({ ...DEFAULT_DEPS, sendTickMessage });

    // One failure
    vi.advanceTimersByTime(60_000);
    expect(getCaptainCircuitBreakerState().consecutiveFailures).toBe(1);

    // Next tick succeeds — failure count should reset
    shouldThrow = false;
    vi.advanceTimersByTime(60_000);
    expect(getCaptainCircuitBreakerState().consecutiveFailures).toBe(0);
  });

  it('circuit breaker is independent of rate-limit backoff', () => {
    // Trigger rate limit (backoff), verify circuit is still closed
    notifyRateLimit(10_000);
    expect(getCaptainCircuitBreakerState().consecutiveFailures).toBe(0);
    expect(getCaptainCircuitBreakerState().circuitOpenUntil).toBe(0);

    // Trigger circuit failures, verify backoff multiplier is unaffected
    const throwingDeps = {
      ...DEFAULT_DEPS,
      sendTickMessage: vi.fn(() => {
        throw new Error('crash');
      }),
    };
    startTickLoop(throwingDeps);

    // Advance past rate limit window (10s) — but backoff multiplier is 2 so interval is 120s
    vi.advanceTimersByTime(120_000);

    // One tick should fire and fail (rate limit window has passed)
    expect(getCaptainCircuitBreakerState().consecutiveFailures).toBeGreaterThanOrEqual(1);
    // Backoff multiplier should still be whatever notifyRateLimit set
    expect(getBackoffState().multiplier).toBe(2);
  });
});
