// Reusable circuit breaker utility
// Implements an immutable state machine: CLOSED → OPEN (after threshold failures)
// → auto-reset after cooldown → CLOSED
//
// Usage:
//   let state = createCircuitBreaker({ threshold: 3, cooldownMs: 60_000 })
//   state = recordFailure(state)         // on error
//   state = recordSuccess(state)         // on success
//   if (isOpen(state)) return;           // guard at call site

export interface CircuitBreakerState {
  consecutiveFailures: number;
  circuitOpenUntil: number;
}

export interface CircuitBreakerConfig {
  threshold: number;
  cooldownMs: number;
}

/**
 * Create an initial (closed) circuit breaker state.
 */
export function createCircuitBreaker(): CircuitBreakerState {
  return {
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
  };
}

/**
 * Record a successful operation. Returns a reset state.
 */
export function recordSuccess(state: CircuitBreakerState): CircuitBreakerState {
  if (state.consecutiveFailures === 0) {
    return state;
  }
  return {
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
  };
}

/**
 * Record a failed operation. Returns new state with incremented failure count.
 * Opens the circuit once the threshold is reached.
 */
export function recordFailure(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
): CircuitBreakerState {
  const consecutiveFailures = state.consecutiveFailures + 1;

  if (consecutiveFailures >= config.threshold) {
    return {
      consecutiveFailures,
      circuitOpenUntil: Date.now() + config.cooldownMs,
    };
  }

  return {
    ...state,
    consecutiveFailures,
  };
}

/**
 * Check whether the circuit is currently open (i.e., requests should be blocked).
 * If the cooldown has elapsed, the circuit auto-resets and returns false.
 * Callers should replace their state with the returned value after calling this.
 */
export function isOpen(state: CircuitBreakerState): { open: boolean; nextState: CircuitBreakerState } {
  if (state.consecutiveFailures === 0) {
    return { open: false, nextState: state };
  }

  if (state.circuitOpenUntil === 0) {
    return { open: false, nextState: state };
  }

  if (Date.now() > state.circuitOpenUntil) {
    // Cooldown elapsed — auto-reset and allow one retry
    return {
      open: false,
      nextState: createCircuitBreaker(),
    };
  }

  return { open: true, nextState: state };
}
