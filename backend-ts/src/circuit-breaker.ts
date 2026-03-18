export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number; // default 5
  cooldownMs: number; // default 60000
}

interface SessionCircuit {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly lastFailureAt: number | null;
  readonly openedAt: number | null;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly circuits: Map<string, SessionCircuit>;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.failureThreshold = config?.failureThreshold ?? 5;
    this.cooldownMs = config?.cooldownMs ?? 60000;
    this.circuits = new Map();
  }

  /**
   * Check if a query can execute. Transitions open->half_open if cooldown elapsed.
   */
  canExecute(sessionId: string): { allowed: boolean; reason?: string } {
    const circuit = this.circuits.get(sessionId);

    if (!circuit) {
      // No circuit state yet, allow execution
      return { allowed: true };
    }

    if (circuit.state === "closed") {
      return { allowed: true };
    }

    if (circuit.state === "open") {
      // Check if cooldown has elapsed
      if (circuit.openedAt !== null) {
        const elapsed = Date.now() - circuit.openedAt;
        if (elapsed >= this.cooldownMs) {
          // Transition to half_open
          this.circuits.set(sessionId, {
            ...circuit,
            state: "half_open",
          });
          return { allowed: true };
        }
      }

      return {
        allowed: false,
        reason: "Circuit open: too many consecutive failures. Retry after cooldown.",
      };
    }

    // half_open state: allow one request through
    return { allowed: true };
  }

  /**
   * Record a successful query. Resets failure count, closes circuit.
   */
  recordSuccess(sessionId: string): void {
    const circuit = this.circuits.get(sessionId);

    if (!circuit) {
      // First interaction, create closed circuit
      this.circuits.set(sessionId, {
        state: "closed",
        consecutiveFailures: 0,
        lastFailureAt: null,
        openedAt: null,
      });
      return;
    }

    // Success resets failures and closes circuit
    this.circuits.set(sessionId, {
      state: "closed",
      consecutiveFailures: 0,
      lastFailureAt: null,
      openedAt: null,
    });
  }

  /**
   * Record a failed query. Increments failures, opens circuit if threshold reached.
   */
  recordFailure(sessionId: string): void {
    const circuit = this.circuits.get(sessionId);
    const now = Date.now();

    if (!circuit) {
      // First interaction is a failure
      const newFailures = 1;
      const shouldOpen = newFailures >= this.failureThreshold;

      this.circuits.set(sessionId, {
        state: shouldOpen ? "open" : "closed",
        consecutiveFailures: newFailures,
        lastFailureAt: now,
        openedAt: shouldOpen ? now : null,
      });
      return;
    }

    const newFailures = circuit.consecutiveFailures + 1;
    const shouldOpen = newFailures >= this.failureThreshold;

    this.circuits.set(sessionId, {
      state: shouldOpen ? "open" : circuit.state,
      consecutiveFailures: newFailures,
      lastFailureAt: now,
      openedAt: shouldOpen ? now : circuit.openedAt,
    });
  }

  /**
   * Get current state for a session.
   */
  getState(sessionId: string): CircuitState {
    const circuit = this.circuits.get(sessionId);
    return circuit?.state ?? "closed";
  }

  /**
   * Get stats for diagnostics.
   */
  getStats(): { sessions: number; openCircuits: string[] } {
    const openCircuits: string[] = [];

    for (const [sessionId, circuit] of this.circuits.entries()) {
      if (circuit.state === "open") {
        openCircuits.push(sessionId);
      }
    }

    return {
      sessions: this.circuits.size,
      openCircuits,
    };
  }

  /**
   * Manual reset of a circuit.
   */
  reset(sessionId: string): void {
    this.circuits.set(sessionId, {
      state: "closed",
      consecutiveFailures: 0,
      lastFailureAt: null,
      openedAt: null,
    });
  }
}
