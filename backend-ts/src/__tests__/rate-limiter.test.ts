import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "../rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Messages within limit", () => {
    it("should allow messages under the limit", () => {
      const limiter = new RateLimiter({ maxMessages: 5, windowMs: 60000 });
      const sessionId = "session_1";

      for (let i = 0; i < 5; i++) {
        const result = limiter.check(sessionId);
        expect(result.allowed).toBe(true);
        expect(result.retryAfterMs).toBe(0);
      }
    });

    it("should allow messages from different sessions independently", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });

      const result1 = limiter.check("session_1");
      const result2 = limiter.check("session_2");
      const result3 = limiter.check("session_1");
      const result4 = limiter.check("session_2");

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
      expect(result4.allowed).toBe(true);
    });
  });

  describe("Messages exceeding limit", () => {
    it("should reject messages exceeding the limit", () => {
      const limiter = new RateLimiter({ maxMessages: 3, windowMs: 60000 });
      const sessionId = "session_1";

      // First 3 messages allowed
      for (let i = 0; i < 3; i++) {
        const result = limiter.check(sessionId);
        expect(result.allowed).toBe(true);
      }

      // 4th message rejected
      const result = limiter.check(sessionId);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it("should return correct retryAfterMs when rate limited", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });
      const sessionId = "session_1";

      // Start at t=0
      vi.setSystemTime(0);
      limiter.check(sessionId);

      // Second message at t=1000
      vi.advanceTimersByTime(1000);
      limiter.check(sessionId);

      // Third message at t=2000 (should be rejected)
      vi.advanceTimersByTime(1000);
      const result = limiter.check(sessionId);

      expect(result.allowed).toBe(false);
      // Should wait until first message expires: 60000 - 2000 = 58000ms
      expect(result.retryAfterMs).toBe(58000);
    });
  });

  describe("Sliding window behavior", () => {
    it("should restore capacity as old messages expire", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });
      const sessionId = "session_1";

      // t=0: First message
      vi.setSystemTime(0);
      expect(limiter.check(sessionId).allowed).toBe(true);

      // t=1000: Second message
      vi.advanceTimersByTime(1000);
      expect(limiter.check(sessionId).allowed).toBe(true);

      // t=2000: Third message (rejected)
      vi.advanceTimersByTime(1000);
      expect(limiter.check(sessionId).allowed).toBe(false);

      // t=61000: First message expired, capacity restored
      vi.advanceTimersByTime(59000);
      const result = limiter.check(sessionId);
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    });

    it("should prune expired timestamps on each check", () => {
      const limiter = new RateLimiter({ maxMessages: 3, windowMs: 10000 });
      const sessionId = "session_1";

      // Fill the limit
      vi.setSystemTime(0);
      limiter.check(sessionId);
      vi.advanceTimersByTime(1000);
      limiter.check(sessionId);
      vi.advanceTimersByTime(1000);
      limiter.check(sessionId);

      // Now at limit
      expect(limiter.check(sessionId).allowed).toBe(false);

      // Advance past window
      vi.advanceTimersByTime(11000);

      // All timestamps should be pruned, full capacity restored
      expect(limiter.check(sessionId).allowed).toBe(true);
      expect(limiter.check(sessionId).allowed).toBe(true);
      expect(limiter.check(sessionId).allowed).toBe(true);
    });
  });

  describe("reset()", () => {
    it("should clear a session's history", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });
      const sessionId = "session_1";

      // Fill the limit
      limiter.check(sessionId);
      limiter.check(sessionId);

      // Should be at limit
      expect(limiter.check(sessionId).allowed).toBe(false);

      // Reset
      limiter.reset(sessionId);

      // Capacity should be restored
      expect(limiter.check(sessionId).allowed).toBe(true);
      expect(limiter.check(sessionId).allowed).toBe(true);
    });

    it("should not affect other sessions", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });

      limiter.check("session_1");
      limiter.check("session_2");
      limiter.check("session_1");
      limiter.check("session_2");

      // Both at limit
      expect(limiter.check("session_1").allowed).toBe(false);
      expect(limiter.check("session_2").allowed).toBe(false);

      // Reset session_1
      limiter.reset("session_1");

      // session_1 restored, session_2 still limited
      expect(limiter.check("session_1").allowed).toBe(true);
      expect(limiter.check("session_2").allowed).toBe(false);
    });
  });

  describe("getStats()", () => {
    it("should report correct total sessions", () => {
      const limiter = new RateLimiter({ maxMessages: 5, windowMs: 60000 });

      limiter.check("session_1");
      limiter.check("session_2");
      limiter.check("session_3");

      const stats = limiter.getStats();
      expect(stats.totalSessions).toBe(3);
    });

    it("should identify rate-limited sessions", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });

      // session_1: at limit
      limiter.check("session_1");
      limiter.check("session_1");

      // session_2: under limit
      limiter.check("session_2");

      // session_3: at limit
      limiter.check("session_3");
      limiter.check("session_3");

      const stats = limiter.getStats();
      expect(stats.totalSessions).toBe(3);
      expect(stats.rateLimitedSessions).toContain("session_1");
      expect(stats.rateLimitedSessions).not.toContain("session_2");
      expect(stats.rateLimitedSessions).toContain("session_3");
      expect(stats.rateLimitedSessions.length).toBe(2);
    });

    it("should not include sessions with expired timestamps as rate-limited", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 10000 });

      // Fill limit for session_1
      vi.setSystemTime(0);
      limiter.check("session_1");
      limiter.check("session_1");

      // Initially rate-limited
      let stats = limiter.getStats();
      expect(stats.rateLimitedSessions).toContain("session_1");

      // Advance past window
      vi.advanceTimersByTime(11000);

      // Should no longer be rate-limited (timestamps expired)
      stats = limiter.getStats();
      expect(stats.rateLimitedSessions).not.toContain("session_1");
    });
  });

  describe("Custom config", () => {
    it("should respect custom maxMessages", () => {
      const limiter = new RateLimiter({ maxMessages: 10, windowMs: 60000 });
      const sessionId = "session_1";

      for (let i = 0; i < 10; i++) {
        expect(limiter.check(sessionId).allowed).toBe(true);
      }

      expect(limiter.check(sessionId).allowed).toBe(false);
    });

    it("should respect custom windowMs", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 5000 });
      const sessionId = "session_1";

      vi.setSystemTime(0);
      limiter.check(sessionId);
      limiter.check(sessionId);

      // At limit
      expect(limiter.check(sessionId).allowed).toBe(false);

      // Advance 6 seconds (past the 5s window)
      vi.advanceTimersByTime(6000);

      // Capacity restored
      expect(limiter.check(sessionId).allowed).toBe(true);
    });

    it("should use defaults when no config provided", () => {
      const limiter = new RateLimiter();
      const sessionId = "session_1";

      // Default is 20 messages
      for (let i = 0; i < 20; i++) {
        expect(limiter.check(sessionId).allowed).toBe(true);
      }

      expect(limiter.check(sessionId).allowed).toBe(false);
    });

    it("should use defaults for missing config properties", () => {
      const limiter = new RateLimiter({ maxMessages: 3 });
      const sessionId = "session_1";

      vi.setSystemTime(0);
      limiter.check(sessionId);
      limiter.check(sessionId);
      limiter.check(sessionId);

      // At limit
      const result = limiter.check(sessionId);
      expect(result.allowed).toBe(false);

      // Default windowMs is 60000
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });
  });

  describe("retryAfterMs calculation", () => {
    it("should calculate retryAfterMs based on oldest entry expiration", () => {
      const limiter = new RateLimiter({ maxMessages: 3, windowMs: 60000 });
      const sessionId = "session_1";

      // t=0: First message
      vi.setSystemTime(0);
      limiter.check(sessionId);

      // t=10000: Second message
      vi.advanceTimersByTime(10000);
      limiter.check(sessionId);

      // t=20000: Third message
      vi.advanceTimersByTime(10000);
      limiter.check(sessionId);

      // t=30000: Fourth message (rejected)
      vi.advanceTimersByTime(10000);
      const result = limiter.check(sessionId);

      expect(result.allowed).toBe(false);
      // First message expires at 60000, current time is 30000
      // retryAfterMs = 60000 - 30000 = 30000
      expect(result.retryAfterMs).toBe(30000);
    });

    it("should return 0 retryAfterMs when message is allowed", () => {
      const limiter = new RateLimiter({ maxMessages: 5, windowMs: 60000 });
      const sessionId = "session_1";

      const result = limiter.check(sessionId);
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    });

    it("should handle retryAfterMs at boundary conditions", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });
      const sessionId = "session_1";

      // t=0: First message
      vi.setSystemTime(0);
      limiter.check(sessionId);

      // t=59999: Second message (just before first expires)
      vi.advanceTimersByTime(59999);
      limiter.check(sessionId);

      // t=59999: Third message (rejected)
      const result = limiter.check(sessionId);
      expect(result.allowed).toBe(false);
      // First message expires at 60000, current time is 59999
      expect(result.retryAfterMs).toBe(1);
    });
  });

  describe("Different sessions have independent limits", () => {
    it("should not affect other sessions when one is rate-limited", () => {
      const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });

      // session_1: fill limit
      limiter.check("session_1");
      limiter.check("session_1");

      // session_1 is rate-limited
      expect(limiter.check("session_1").allowed).toBe(false);

      // session_2 should still be able to send messages
      expect(limiter.check("session_2").allowed).toBe(true);
      expect(limiter.check("session_2").allowed).toBe(true);
      expect(limiter.check("session_2").allowed).toBe(false);

      // session_3 should also be independent
      expect(limiter.check("session_3").allowed).toBe(true);
    });

    it("should track multiple sessions simultaneously", () => {
      const limiter = new RateLimiter({ maxMessages: 3, windowMs: 60000 });

      // Interleave messages from different sessions
      limiter.check("session_1");
      limiter.check("session_2");
      limiter.check("session_1");
      limiter.check("session_3");
      limiter.check("session_2");
      limiter.check("session_1");
      limiter.check("session_2");

      // session_1: 3 messages (at limit)
      expect(limiter.check("session_1").allowed).toBe(false);

      // session_2: 3 messages (at limit)
      expect(limiter.check("session_2").allowed).toBe(false);

      // session_3: 1 message (under limit)
      expect(limiter.check("session_3").allowed).toBe(true);
    });
  });
});
