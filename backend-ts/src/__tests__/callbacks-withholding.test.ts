import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

vi.mock('../event-log.js', () => {
  let seq = 0;
  const mockEventLog = {
    append: vi.fn((sessionId: string, type: string, data: unknown) => ({
      seq: ++seq,
      type,
      data,
      timestamp: new Date().toISOString(),
    })),
    getEventsSince: vi.fn(() => []),
    clear: vi.fn(),
    hasSession: vi.fn(() => false),
    getLastSeq: vi.fn(() => 0),
    getOldestSeq: vi.fn(() => 0),
    getEventCount: vi.fn(() => 0),
    fullResetRequired: vi.fn(() => false),
  };

  class EventLog {}

  return { EventLog, eventLog: mockEventLog };
});

// ---- Helpers ----

function makeIo() {
  const emitted: Array<{ event: string; data: unknown }> = [];
  return {
    to: vi.fn().mockReturnValue({
      emit: vi.fn((event: string, data: unknown) => {
        emitted.push({ event, data });
      }),
    }),
    off: vi.fn(),
    on: vi.fn(),
    _emitted: emitted,
  };
}

function makeDeps(io: ReturnType<typeof makeIo>) {
  return {
    io: io as unknown as import('socket.io').Server,
    database: {
      incrementUserStats: vi.fn(),
      recordQueryUsage: vi.fn(),
      updateSessionContext: vi.fn(),
      recordRateLimitEvent: vi.fn(),
    } as unknown as import('../routes/types.js').RouteDependencies['database'],
    log: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as import('../routes/types.js').RouteDependencies['log'],
  };
}

// Import after mocks
const { buildSocketCallbacks, clearDeltaBuffer, clearSessionState } = await import('../socket/callbacks.js');
const {
  getWithholdingState,
  clearWithholdingState,
  WITHHOLDING_TIMEOUT_MS,
} = await import('../socket/withholding.js');

const SESSION_ID = 'test-withholding-session';

describe('withholding pattern in buildSocketCallbacks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSessionState(SESSION_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSessionState(SESSION_ID);
  });

  // ---- Rate limit triggering withholding ----

  it('always emits rate_limit event immediately (never withheld)', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 5000, rateLimitedAt: new Date().toISOString() });

    const rateLimitEmits = io._emitted.filter(e => e.event === 'rate_limit');
    expect(rateLimitEmits).toHaveLength(1);
  });

  it('starts withholding after onRateLimit', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 5000, rateLimitedAt: new Date().toISOString() });

    expect(getWithholdingState(SESSION_ID).active).toBe(true);
  });

  // ---- text_delta buffering while withholding ----

  it('first text_delta after rate limit signals recovery and stops withholding', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    expect(getWithholdingState(SESSION_ID).active).toBe(true);

    // First text that arrives is treated as recovery signal — discards buffer, stops withholding
    callbacks.onText('first text after recovery', 0);

    expect(getWithholdingState(SESSION_ID).active).toBe(false);
  });

  it('first text_delta after rate limit is emitted normally to frontend', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    callbacks.onText('recovery text', 0);
    vi.advanceTimersByTime(30); // flush coalesce timer

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    expect(textDeltaEmits).toHaveLength(1);
    expect((textDeltaEmits[0].data as Record<string, unknown>).text).toBe('recovery text');
  });

  // ---- tool_event buffering while withholding ----

  it('buffers tool_event when withholding is active', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    callbacks.onToolEvent({ type: 'tool_start', tool_name: 'Read', tool_use_id: 'tu_1' });

    const toolEmits = io._emitted.filter(e => e.event === 'tool_event');
    expect(toolEmits).toHaveLength(0);

    const state = getWithholdingState(SESSION_ID);
    expect(state.buffer.some(e => e.event === 'tool_event')).toBe(true);
  });

  // ---- Recovery success: onText discards buffer ----

  it('discards any withheld tool_events when first text arrives (recovery success)', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    // Rate limit fires, then tool events get buffered
    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    callbacks.onToolEvent({ type: 'tool_start', tool_name: 'Read', tool_use_id: 'tu_1' });

    // Buffer has withheld tool_event
    const stateBefore = getWithholdingState(SESSION_ID);
    expect(stateBefore.buffer.some(e => e.event === 'tool_event')).toBe(true);

    // SDK retries and new text arrives — discards the withheld tool events
    callbacks.onText('fresh recovery text', 0);

    // Withheld buffer was discarded — tool events never reach frontend
    const toolEmits = io._emitted.filter(e => e.event === 'tool_event');
    expect(toolEmits).toHaveLength(0);
    expect(getWithholdingState(SESSION_ID).active).toBe(false);
  });

  it('subsequent text after recovery is emitted normally', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });

    // Recovery text arrives
    callbacks.onText('part 1', 0);
    callbacks.onText('part 2', 0);
    vi.advanceTimersByTime(30);

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    expect(textDeltaEmits).toHaveLength(1);
    expect((textDeltaEmits[0].data as Record<string, unknown>).text).toBe('part 1part 2');
  });

  // ---- Recovery success: onComplete discards buffer ----

  it('discards withheld tool_events on onComplete (recovery success via completion)', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    // Only tool events buffered (no text yet — rate limit fired mid-tools)
    callbacks.onToolEvent({ type: 'tool_start', tool_name: 'Read', tool_use_id: 'tu_1' });
    callbacks.onToolEvent({ type: 'tool_complete', tool_name: 'Read', tool_use_id: 'tu_1' });

    expect(getWithholdingState(SESSION_ID).active).toBe(true);

    callbacks.onComplete({ cost: 0.01, duration_ms: 100 });

    // Withholding cleared by onComplete
    expect(getWithholdingState(SESSION_ID).active).toBe(false);

    // Buffered tool events should NOT have been emitted
    const toolEmits = io._emitted.filter(e => e.event === 'tool_event');
    expect(toolEmits).toHaveLength(0);
  });

  // ---- Recovery failure: onError flushes buffer ----

  it('flushes withheld buffer to frontend when error occurs while withholding', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    callbacks.onText('partial text', 0);
    vi.advanceTimersByTime(30); // flush coalesce timer — goes to buffer
    callbacks.onToolEvent({ type: 'tool_start', tool_name: 'Read', tool_use_id: 'tu_1' });

    // Error during recovery — should flush buffer then emit error
    callbacks.onError('API overloaded, retry failed');

    // Withheld events should now be emitted
    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    const toolEmits = io._emitted.filter(e => e.event === 'tool_event');
    const errorEmits = io._emitted.filter(e => e.event === 'error');

    expect(textDeltaEmits).toHaveLength(1);
    expect(toolEmits).toHaveLength(1);
    expect(errorEmits).toHaveLength(1);
  });

  it('stops withholding after error flushes buffer', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    callbacks.onError('failed');

    expect(getWithholdingState(SESSION_ID).active).toBe(false);
  });

  it('emits flushed events before error event', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    callbacks.onText('buffered text', 0);
    vi.advanceTimersByTime(30);
    callbacks.onError('recovery failed');

    const textDeltaIdx = io._emitted.findIndex(e => e.event === 'text_delta');
    const errorIdx = io._emitted.findIndex(e => e.event === 'error');

    expect(textDeltaIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThan(textDeltaIdx);
  });

  // ---- Safety timeout ----

  it('flushes buffer to frontend after safety timeout', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    callbacks.onText('partial text', 0);
    vi.advanceTimersByTime(30); // coalesce flush → buffer

    // Advance past safety timeout
    vi.advanceTimersByTime(WITHHOLDING_TIMEOUT_MS);

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    expect(textDeltaEmits).toHaveLength(1);

    // Withholding should be cleared
    expect(getWithholdingState(SESSION_ID).active).toBe(false);
  });

  it('logs a warning when safety timeout fires', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });

    vi.advanceTimersByTime(WITHHOLDING_TIMEOUT_MS);

    expect((deps.log.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    const warnCall = (deps.log.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(warnCall[0]).toContain('Withholding safety timeout');
  });

  // ---- No withholding without rate limit ----

  it('emits text_delta normally when no withholding is active', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('normal text', 0);
    vi.advanceTimersByTime(30);

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    expect(textDeltaEmits).toHaveLength(1);
  });

  it('emits tool_event normally when no withholding is active', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onToolEvent({ type: 'tool_start', tool_name: 'Read', tool_use_id: 'tu_1' });

    const toolEmits = io._emitted.filter(e => e.event === 'tool_event');
    expect(toolEmits).toHaveLength(1);
  });

  // ---- Second rate limit while already withholding ----

  it('does not reset the safety timer if rate limit fires while already withholding', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    const stateAfterFirst = getWithholdingState(SESSION_ID);
    const timerAfterFirst = stateAfterFirst.timer;

    callbacks.onRateLimit({ retryAfterMs: 2000, rateLimitedAt: new Date().toISOString() });
    const stateAfterSecond = getWithholdingState(SESSION_ID);

    // Timer should be the same object (not replaced)
    expect(stateAfterSecond.timer).toBe(timerAfterFirst);
    expect(stateAfterSecond.active).toBe(true);
  });

  // ---- Isolation between sessions ----

  it('withholding state is independent per session', () => {
    const SESSION_A = 'withholding-session-a';
    const SESSION_B = 'withholding-session-b';

    try {
      const io = makeIo();
      const depsA = makeDeps(io);
      const depsB = makeDeps(io);

      const callbacksA = buildSocketCallbacks(SESSION_A, undefined, depsA);
      const callbacksB = buildSocketCallbacks(SESSION_B, undefined, depsB);

      callbacksA.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });

      expect(getWithholdingState(SESSION_A).active).toBe(true);
      expect(getWithholdingState(SESSION_B).active).toBe(false);

      callbacksB.onText('session B text', 0);
      vi.advanceTimersByTime(30);

      const sessionBEmits = io._emitted.filter(
        e => e.event === 'text_delta' &&
          (e.data as Record<string, unknown>).session_id === SESSION_B
      );
      expect(sessionBEmits).toHaveLength(1);
    } finally {
      clearSessionState(SESSION_A);
      clearSessionState(SESSION_B);
    }
  });

  // ---- clearSessionState cleanup ----

  it('clearSessionState cleans up withholding state', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onRateLimit({ retryAfterMs: 1000, rateLimitedAt: new Date().toISOString() });
    expect(getWithholdingState(SESSION_ID).active).toBe(true);

    clearSessionState(SESSION_ID);

    expect(getWithholdingState(SESSION_ID).active).toBe(false);
  });
});
