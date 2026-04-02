import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

// We need to intercept the module-level eventLog singleton used by callbacks.ts
// Use vi.mock to replace the event-log module
vi.mock('../event-log.js', () => {
  const mockEventLog = {
    append: vi.fn((sessionId: string, type: string, data: unknown) => ({
      seq: 1,
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

  // Provide a stub EventLog class so imports don't break
  class EventLog {}

  return {
    EventLog,
    eventLog: mockEventLog,
  };
});

// ---- Test helpers ----

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

// ---- Import after mocks are set up ----
const { buildSocketCallbacks, clearDeltaBuffer } = await import('../socket/callbacks.js');
const { eventLog } = await import('../event-log.js');
const mockEventLog = eventLog as unknown as { append: ReturnType<typeof vi.fn> };

describe('text_delta coalescing in buildSocketCallbacks', () => {
  const SESSION_ID = 'test-session-coalesce';

  beforeEach(() => {
    vi.useFakeTimers();
    mockEventLog.append.mockReset();
    let seq = 0;
    mockEventLog.append.mockImplementation((sid: string, type: string, data: unknown) => ({
      seq: ++seq,
      type,
      data,
      timestamp: new Date().toISOString(),
    }));
    clearDeltaBuffer(SESSION_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearDeltaBuffer(SESSION_ID);
  });

  it('does not emit immediately on first text delta', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('Hello', 0);

    expect(io._emitted).toHaveLength(0);
    expect(mockEventLog.append).not.toHaveBeenCalled();
  });

  it('emits a single coalesced text_delta after 30ms', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('Hello', 0);
    callbacks.onText(' world', 0);
    callbacks.onText('!', 0);

    expect(io._emitted).toHaveLength(0);

    vi.advanceTimersByTime(30);

    expect(io._emitted).toHaveLength(1);
    expect(io._emitted[0].event).toBe('text_delta');
    const data = io._emitted[0].data as Record<string, unknown>;
    expect(data.text).toBe('Hello world!');
    expect(data.message_index).toBe(0);
    expect(data.session_id).toBe(SESSION_ID);
  });

  it('records exactly one eventLog entry for the coalesced batch', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('a', 0);
    callbacks.onText('b', 0);
    callbacks.onText('c', 0);

    vi.advanceTimersByTime(30);

    const textDeltaCalls = mockEventLog.append.mock.calls.filter(
      ([, type]) => type === 'text_delta'
    );
    expect(textDeltaCalls).toHaveLength(1);
    expect(textDeltaCalls[0][2]).toMatchObject({ text: 'abc', message_index: 0 });
  });

  it('flushes immediately when messageIndex changes (message boundary)', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('Message 0', 0);
    // No timer advance — boundary triggers flush
    callbacks.onText('Message 1', 1);

    // The message 0 batch should have been flushed synchronously
    expect(io._emitted).toHaveLength(1);
    expect((io._emitted[0].data as Record<string, unknown>).text).toBe('Message 0');
    expect((io._emitted[0].data as Record<string, unknown>).message_index).toBe(0);
  });

  it('flushes pending buffer before response_complete and clears buffer', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('partial', 0);

    // Timer has NOT fired yet
    callbacks.onComplete({ cost: 0.01, duration_ms: 100, input_tokens: 10, output_tokens: 5 });

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    const completeEmits = io._emitted.filter(e => e.event === 'response_complete');

    expect(textDeltaEmits).toHaveLength(1);
    expect((textDeltaEmits[0].data as Record<string, unknown>).text).toBe('partial');
    // response_complete must come AFTER the text_delta
    const textDeltaIdx = io._emitted.findIndex(e => e.event === 'text_delta');
    const completeIdx = io._emitted.findIndex(e => e.event === 'response_complete');
    expect(textDeltaIdx).toBeLessThan(completeIdx);
    expect(completeEmits).toHaveLength(1);
  });

  it('flushes pending buffer before error and clears buffer', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('partial text', 0);
    callbacks.onError('Something went wrong');

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    const errorEmits = io._emitted.filter(e => e.event === 'error');

    expect(textDeltaEmits).toHaveLength(1);
    expect((textDeltaEmits[0].data as Record<string, unknown>).text).toBe('partial text');
    expect(errorEmits).toHaveLength(1);

    // Confirm error comes after delta
    const textDeltaIdx = io._emitted.findIndex(e => e.event === 'text_delta');
    const errorIdx = io._emitted.findIndex(e => e.event === 'error');
    expect(textDeltaIdx).toBeLessThan(errorIdx);
  });

  it('does not emit text_delta after response_complete when buffer is empty', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onComplete({ cost: 0.01 });

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    expect(textDeltaEmits).toHaveLength(0);
  });

  it('respects independent buffers per session', () => {
    const SESSION_A = 'session-coalesce-a';
    const SESSION_B = 'session-coalesce-b';

    const io = makeIo();
    const deps = makeDeps(io);

    const callbacksA = buildSocketCallbacks(SESSION_A, undefined, deps);
    const callbacksB = buildSocketCallbacks(SESSION_B, undefined, deps);

    try {
      callbacksA.onText('from A', 0);
      callbacksB.onText('from B', 0);

      vi.advanceTimersByTime(30);

      const emittedA = io._emitted.filter(
        e => e.event === 'text_delta' && (e.data as Record<string, unknown>).session_id === SESSION_A
      );
      const emittedB = io._emitted.filter(
        e => e.event === 'text_delta' && (e.data as Record<string, unknown>).session_id === SESSION_B
      );

      expect(emittedA).toHaveLength(1);
      expect((emittedA[0].data as Record<string, unknown>).text).toBe('from A');

      expect(emittedB).toHaveLength(1);
      expect((emittedB[0].data as Record<string, unknown>).text).toBe('from B');
    } finally {
      clearDeltaBuffer(SESSION_A);
      clearDeltaBuffer(SESSION_B);
    }
  });

  it('does not re-emit after timer fires when buffer was already flushed by onComplete', () => {
    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('text', 0);
    callbacks.onComplete({ cost: 0 });

    // Advance timer — should NOT trigger a second emission
    vi.advanceTimersByTime(30);

    const textDeltaEmits = io._emitted.filter(e => e.event === 'text_delta');
    expect(textDeltaEmits).toHaveLength(1);
  });

  it('emits seq number from eventLog on flushed delta', () => {
    mockEventLog.append.mockImplementation((sid: string, type: string, data: unknown) => ({
      seq: 42,
      type,
      data,
      timestamp: new Date().toISOString(),
    }));

    const io = makeIo();
    const deps = makeDeps(io);
    const callbacks = buildSocketCallbacks(SESSION_ID, undefined, deps);

    callbacks.onText('test', 0);
    vi.advanceTimersByTime(30);

    expect((io._emitted[0].data as Record<string, unknown>).seq).toBe(42);
  });
});
