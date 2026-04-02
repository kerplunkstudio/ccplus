import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCircuitBreaker,
  recordSuccess,
  recordFailure,
  isOpen,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
} from '../circuit-breaker.js';

const CONFIG: CircuitBreakerConfig = { threshold: 3, cooldownMs: 60_000 };

describe('circuit-breaker: createCircuitBreaker()', () => {
  it('returns a closed circuit with zero failures', () => {
    const state = createCircuitBreaker();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.circuitOpenUntil).toBe(0);
  });

  it('returns a new object on every call', () => {
    const a = createCircuitBreaker();
    const b = createCircuitBreaker();
    expect(a).not.toBe(b);
  });
});

describe('circuit-breaker: recordSuccess()', () => {
  it('resets consecutiveFailures to 0', () => {
    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG);
    state = recordFailure(state, CONFIG);
    state = recordSuccess(state);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.circuitOpenUntil).toBe(0);
  });

  it('returns the same reference when already at zero (no-op optimisation)', () => {
    const state = createCircuitBreaker();
    const next = recordSuccess(state);
    expect(next).toBe(state);
  });

  it('does not mutate the input state', () => {
    const original: CircuitBreakerState = { consecutiveFailures: 2, circuitOpenUntil: 0 };
    const copy = { ...original };
    recordSuccess(original);
    expect(original).toEqual(copy);
  });
});

describe('circuit-breaker: recordFailure()', () => {
  it('increments consecutiveFailures by 1', () => {
    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG);
    expect(state.consecutiveFailures).toBe(1);
  });

  it('does not open circuit below threshold', () => {
    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG); // 1
    state = recordFailure(state, CONFIG); // 2 (threshold=3)
    expect(state.circuitOpenUntil).toBe(0);
  });

  it('opens circuit at the threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG); // 1
    state = recordFailure(state, CONFIG); // 2
    state = recordFailure(state, CONFIG); // 3 — threshold reached

    expect(state.consecutiveFailures).toBe(3);
    expect(state.circuitOpenUntil).toBe(1_000_000 + 60_000);

    vi.useRealTimers();
  });

  it('keeps circuit open past threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    let state = createCircuitBreaker();
    for (let i = 0; i < 5; i++) {
      state = recordFailure(state, CONFIG);
    }

    expect(state.consecutiveFailures).toBe(5);
    expect(state.circuitOpenUntil).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('does not mutate the input state', () => {
    const original: CircuitBreakerState = { consecutiveFailures: 0, circuitOpenUntil: 0 };
    const copy = { ...original };
    recordFailure(original, CONFIG);
    expect(original).toEqual(copy);
  });

  it('respects custom threshold and cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(500);

    const customConfig: CircuitBreakerConfig = { threshold: 1, cooldownMs: 5_000 };
    let state = createCircuitBreaker();
    state = recordFailure(state, customConfig);

    expect(state.consecutiveFailures).toBe(1);
    expect(state.circuitOpenUntil).toBe(5_500);

    vi.useRealTimers();
  });
});

describe('circuit-breaker: isOpen()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns open=false for a fresh circuit', () => {
    const state = createCircuitBreaker();
    const { open } = isOpen(state);
    expect(open).toBe(false);
  });

  it('returns open=false when below threshold', () => {
    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG); // 1 failure, not yet open
    const { open } = isOpen(state);
    expect(open).toBe(false);
  });

  it('returns open=true when circuit is tripped and cooldown has not elapsed', () => {
    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG);
    state = recordFailure(state, CONFIG);
    state = recordFailure(state, CONFIG); // opens circuit

    const { open } = isOpen(state);
    expect(open).toBe(true);
  });

  it('returns open=false and resets state once cooldown elapses', () => {
    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG);
    state = recordFailure(state, CONFIG);
    state = recordFailure(state, CONFIG); // opens circuit

    // Advance time past cooldown
    vi.setSystemTime(1_000_000 + 60_000 + 1);

    const { open, nextState } = isOpen(state);
    expect(open).toBe(false);
    expect(nextState.consecutiveFailures).toBe(0);
    expect(nextState.circuitOpenUntil).toBe(0);
  });

  it('returns original state reference (no-op) when circuit is closed and fresh', () => {
    const state = createCircuitBreaker();
    const { nextState } = isOpen(state);
    expect(nextState).toBe(state);
  });

  it('does not mutate the input state', () => {
    let state = createCircuitBreaker();
    state = recordFailure(state, CONFIG);
    state = recordFailure(state, CONFIG);
    state = recordFailure(state, CONFIG);

    const copy = { ...state };
    isOpen(state);
    expect(state).toEqual(copy);
  });
});

describe('circuit-breaker: immutability — no shared state between instances', () => {
  it('two independent state objects do not interfere', () => {
    const config: CircuitBreakerConfig = { threshold: 2, cooldownMs: 1_000 };

    let stateA = createCircuitBreaker();
    let stateB = createCircuitBreaker();

    stateA = recordFailure(stateA, config);
    stateA = recordFailure(stateA, config); // open

    expect(stateB.consecutiveFailures).toBe(0);
    expect(isOpen(stateB).open).toBe(false);
  });
});
