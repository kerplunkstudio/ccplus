import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initial state", () => {
    it("should start with circuit closed and allow execution", () => {
      const result = breaker.canExecute("session1");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(breaker.getState("session1")).toBe("closed");
    });
  });

  describe("Success tracking", () => {
    it("should keep circuit closed after success", () => {
      breaker.recordSuccess("session1");
      expect(breaker.getState("session1")).toBe("closed");
      expect(breaker.canExecute("session1").allowed).toBe(true);
    });

    it("should reset failure count after success", () => {
      breaker.recordFailure("session1");
      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("closed");

      breaker.recordSuccess("session1");
      expect(breaker.getState("session1")).toBe("closed");

      // Should require 5 more failures to open
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure("session1");
        expect(breaker.getState("session1")).toBe("closed");
      }

      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("open");
    });
  });

  describe("Failure threshold", () => {
    it("should open circuit after 5 consecutive failures (default)", () => {
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure("session1");
        expect(breaker.getState("session1")).toBe("closed");
        expect(breaker.canExecute("session1").allowed).toBe(true);
      }

      // 5th failure should open the circuit
      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("open");

      const result = breaker.canExecute("session1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Circuit open: too many consecutive failures. Retry after cooldown.");
    });

    it("should respect custom failure threshold", () => {
      const customBreaker = new CircuitBreaker({ failureThreshold: 3 });

      for (let i = 0; i < 2; i++) {
        customBreaker.recordFailure("session1");
        expect(customBreaker.getState("session1")).toBe("closed");
      }

      customBreaker.recordFailure("session1");
      expect(customBreaker.getState("session1")).toBe("open");
    });
  });

  describe("Open circuit behavior", () => {
    it("should block execution while circuit is open", () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }

      expect(breaker.getState("session1")).toBe("open");

      const result = breaker.canExecute("session1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Circuit open");
    });
  });

  describe("Cooldown and half-open transition", () => {
    it("should transition to half_open after cooldown period", () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }
      expect(breaker.getState("session1")).toBe("open");

      // Advance time by 59 seconds (just before cooldown)
      vi.advanceTimersByTime(59000);

      let result = breaker.canExecute("session1");
      expect(result.allowed).toBe(false);
      expect(breaker.getState("session1")).toBe("open");

      // Advance time by 1 more second (cooldown complete)
      vi.advanceTimersByTime(1000);

      result = breaker.canExecute("session1");
      expect(result.allowed).toBe(true);
      expect(breaker.getState("session1")).toBe("half_open");
    });

    it("should respect custom cooldown period", () => {
      const customBreaker = new CircuitBreaker({ cooldownMs: 30000 });

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        customBreaker.recordFailure("session1");
      }

      // Advance to just before cooldown
      vi.advanceTimersByTime(29000);
      expect(customBreaker.canExecute("session1").allowed).toBe(false);

      // Complete cooldown
      vi.advanceTimersByTime(1000);
      expect(customBreaker.canExecute("session1").allowed).toBe(true);
      expect(customBreaker.getState("session1")).toBe("half_open");
    });
  });

  describe("Half-open state behavior", () => {
    beforeEach(() => {
      // Open circuit and advance past cooldown
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }
      vi.advanceTimersByTime(60000);
      breaker.canExecute("session1"); // Transition to half_open
    });

    it("should allow one request in half_open state", () => {
      expect(breaker.getState("session1")).toBe("half_open");
      expect(breaker.canExecute("session1").allowed).toBe(true);
    });

    it("should close circuit on success in half_open state", () => {
      expect(breaker.getState("session1")).toBe("half_open");

      breaker.recordSuccess("session1");
      expect(breaker.getState("session1")).toBe("closed");
      expect(breaker.canExecute("session1").allowed).toBe(true);
    });

    it("should reopen circuit on failure in half_open state", () => {
      expect(breaker.getState("session1")).toBe("half_open");

      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("open");

      const result = breaker.canExecute("session1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Circuit open");
    });

    it("should reset openedAt timestamp when reopening from half_open", () => {
      expect(breaker.getState("session1")).toBe("half_open");

      const initialTime = Date.now();
      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("open");

      // Advance time
      vi.advanceTimersByTime(30000);

      // Should still need full cooldown from new openedAt
      expect(breaker.canExecute("session1").allowed).toBe(false);

      // Advance to complete new cooldown
      vi.advanceTimersByTime(30000);
      expect(breaker.canExecute("session1").allowed).toBe(true);
    });
  });

  describe("Session independence", () => {
    it("should track different sessions independently", () => {
      // Open circuit for session1
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }
      expect(breaker.getState("session1")).toBe("open");

      // session2 should be unaffected
      expect(breaker.getState("session2")).toBe("closed");
      expect(breaker.canExecute("session2").allowed).toBe(true);

      // Fail session2 a few times
      breaker.recordFailure("session2");
      breaker.recordFailure("session2");
      expect(breaker.getState("session2")).toBe("closed");

      // session1 should still be open
      expect(breaker.getState("session1")).toBe("open");
    });

    it("should maintain separate failure counts for each session", () => {
      breaker.recordFailure("session1");
      breaker.recordFailure("session1");
      breaker.recordFailure("session1");

      breaker.recordFailure("session2");

      // session1 needs 2 more failures to open
      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("closed");
      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("open");

      // session2 still needs 4 more
      expect(breaker.getState("session2")).toBe("closed");
    });
  });

  describe("Manual reset", () => {
    it("should close circuit and reset failures on manual reset", () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }
      expect(breaker.getState("session1")).toBe("open");

      breaker.reset("session1");
      expect(breaker.getState("session1")).toBe("closed");
      expect(breaker.canExecute("session1").allowed).toBe(true);

      // Should require 5 new failures to open
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure("session1");
        expect(breaker.getState("session1")).toBe("closed");
      }
      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("open");
    });

    it("should reset session even if not previously tracked", () => {
      breaker.reset("new-session");
      expect(breaker.getState("new-session")).toBe("closed");
      expect(breaker.canExecute("new-session").allowed).toBe(true);
    });
  });

  describe("Statistics", () => {
    it("should report correct number of tracked sessions", () => {
      breaker.recordFailure("session1");
      breaker.recordSuccess("session2");
      breaker.recordFailure("session3");

      const stats = breaker.getStats();
      expect(stats.sessions).toBe(3);
    });

    it("should list all open circuits", () => {
      // Open session1
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }

      // Keep session2 closed
      breaker.recordSuccess("session2");

      // Open session3
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session3");
      }

      const stats = breaker.getStats();
      expect(stats.openCircuits).toEqual(expect.arrayContaining(["session1", "session3"]));
      expect(stats.openCircuits).toHaveLength(2);
    });

    it("should report no open circuits when all are closed", () => {
      breaker.recordSuccess("session1");
      breaker.recordSuccess("session2");

      const stats = breaker.getStats();
      expect(stats.openCircuits).toHaveLength(0);
    });

    it("should not list half_open circuits as open", () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }

      // Advance past cooldown to half_open
      vi.advanceTimersByTime(60000);
      breaker.canExecute("session1");

      expect(breaker.getState("session1")).toBe("half_open");

      const stats = breaker.getStats();
      expect(stats.openCircuits).toHaveLength(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle first interaction as failure", () => {
      breaker.recordFailure("session1");
      expect(breaker.getState("session1")).toBe("closed");
      expect(breaker.canExecute("session1").allowed).toBe(true);
    });

    it("should handle first interaction as success", () => {
      breaker.recordSuccess("session1");
      expect(breaker.getState("session1")).toBe("closed");
      expect(breaker.canExecute("session1").allowed).toBe(true);
    });

    it("should handle rapid failure/success cycles", () => {
      breaker.recordFailure("session1");
      breaker.recordSuccess("session1");
      breaker.recordFailure("session1");
      breaker.recordSuccess("session1");

      expect(breaker.getState("session1")).toBe("closed");
      expect(breaker.canExecute("session1").allowed).toBe(true);
    });

    it("should handle exactly threshold failures", () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("session1");
      }

      expect(breaker.getState("session1")).toBe("open");
      expect(breaker.canExecute("session1").allowed).toBe(false);
    });
  });
});
