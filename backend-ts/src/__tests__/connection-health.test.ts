import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConnectionHealthMonitor } from "../connection-health.js";

describe("ConnectionHealthMonitor", () => {
  let monitor: ConnectionHealthMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new ConnectionHealthMonitor({
      staleThresholdMs: 60_000,
      checkIntervalMs: 15_000,
      maxReconnectsPerHour: 10,
      gracePeriodMs: 5_000,
    });
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  describe("onConnect", () => {
    it("registers a new connection", () => {
      monitor.onConnect("session_1");
      const status = monitor.getHealthStatus();

      expect(status.total).toBe(1);
      expect(status.healthy).toBe(1);
      expect(status.stale).toBe(0);
      expect(status.connections[0].sessionId).toBe("session_1");
      expect(status.connections[0].reconnectCount).toBe(0);
    });

    it("increments reconnect count on reconnection", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(10_000);
      monitor.onConnect("session_1");

      const status = monitor.getHealthStatus();
      expect(status.connections[0].reconnectCount).toBe(1);
    });

    it("resets reconnect count after an hour", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(10_000);
      monitor.onConnect("session_1");
      expect(monitor.getReconnectRate("session_1")).toBe(1);

      // Advance time by more than an hour
      vi.advanceTimersByTime(3_600_001);
      monitor.onConnect("session_1");

      // After reset, the reconnect count should be 1 (this reconnection)
      expect(monitor.getReconnectRate("session_1")).toBe(1);
    });

    it("refreshes lastEventTimestamp on reconnection", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(30_000);

      const statusBefore = monitor.getHealthStatus();
      const timeBefore = statusBefore.connections[0].timeSinceLastEventMs;

      monitor.onConnect("session_1");
      const statusAfter = monitor.getHealthStatus();
      const timeAfter = statusAfter.connections[0].timeSinceLastEventMs;

      expect(timeAfter).toBeLessThan(timeBefore);
    });

    it("clears stale flag on reconnection", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(70_000); // Beyond stale threshold
      monitor.evaluateHealth();

      expect(monitor.getStaleConnections()).toContain("session_1");

      monitor.onConnect("session_1");
      expect(monitor.getStaleConnections()).not.toContain("session_1");
    });
  });

  describe("onEvent", () => {
    it("updates lastEventTimestamp", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(10_000);

      const statusBefore = monitor.getHealthStatus();
      const timeBefore = statusBefore.connections[0].timeSinceLastEventMs;

      monitor.onEvent("session_1");
      const statusAfter = monitor.getHealthStatus();
      const timeAfter = statusAfter.connections[0].timeSinceLastEventMs;

      expect(timeAfter).toBeLessThan(timeBefore);
      expect(timeAfter).toBeLessThan(100); // Should be near zero
    });

    it("prevents staleness when events arrive regularly", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(5_000); // Past grace period

      // Send events every 30 seconds for 3 minutes
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(30_000);
        monitor.onEvent("session_1");
        monitor.evaluateHealth();
      }

      expect(monitor.getStaleConnections()).not.toContain("session_1");
    });

    it("clears stale flag when event arrives", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(70_000);
      monitor.evaluateHealth();

      expect(monitor.getStaleConnections()).toContain("session_1");

      monitor.onEvent("session_1");
      expect(monitor.getStaleConnections()).not.toContain("session_1");
    });

    it("does nothing for unknown session", () => {
      monitor.onEvent("nonexistent_session");
      expect(monitor.getHealthStatus().total).toBe(0);
    });
  });

  describe("onDisconnect", () => {
    it("removes connection from tracking", () => {
      monitor.onConnect("session_1");
      expect(monitor.getHealthStatus().total).toBe(1);

      monitor.onDisconnect("session_1");
      expect(monitor.getHealthStatus().total).toBe(0);
    });

    it("does nothing for unknown session", () => {
      monitor.onConnect("session_1");
      monitor.onDisconnect("nonexistent_session");
      expect(monitor.getHealthStatus().total).toBe(1);
    });
  });

  describe("evaluateHealth", () => {
    it("detects stale connection after threshold", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(5_000); // Past grace period
      vi.advanceTimersByTime(60_000); // Past stale threshold

      const staleIds = monitor.evaluateHealth();
      expect(staleIds).toContain("session_1");
      expect(monitor.getStaleConnections()).toContain("session_1");
    });

    it("does not mark connection stale during grace period", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(4_000); // Within grace period (5 seconds)

      const staleIds = monitor.evaluateHealth();
      expect(staleIds).not.toContain("session_1");
      expect(monitor.getStaleConnections()).not.toContain("session_1");
    });

    it("does not mark connection stale before threshold", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(5_000); // Past grace period
      vi.advanceTimersByTime(50_000); // Still within stale threshold (60s)

      const staleIds = monitor.evaluateHealth();
      expect(staleIds).not.toContain("session_1");
    });

    it("returns only newly stale connections", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(65_000);

      const firstEval = monitor.evaluateHealth();
      expect(firstEval).toContain("session_1");

      const secondEval = monitor.evaluateHealth();
      expect(secondEval).not.toContain("session_1"); // Already marked stale
    });

    it("tracks multiple connections independently", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(10_000);
      monitor.onConnect("session_2");
      vi.advanceTimersByTime(5_000); // session_1 at 15s, session_2 at 5s
      monitor.onConnect("session_3");

      vi.advanceTimersByTime(50_000); // session_1 at 65s (stale), session_2 at 55s, session_3 at 50s

      const staleIds = monitor.evaluateHealth();
      expect(staleIds).toContain("session_1");
      expect(staleIds).not.toContain("session_2");
      expect(staleIds).not.toContain("session_3");
    });
  });

  describe("getStaleConnections", () => {
    it("returns empty array when no connections are stale", () => {
      monitor.onConnect("session_1");
      monitor.onConnect("session_2");
      expect(monitor.getStaleConnections()).toEqual([]);
    });

    it("returns all stale session IDs", () => {
      monitor.onConnect("session_1");
      monitor.onConnect("session_2");
      monitor.onConnect("session_3");

      vi.advanceTimersByTime(65_000);
      monitor.evaluateHealth();

      const stale = monitor.getStaleConnections();
      expect(stale).toHaveLength(3);
      expect(stale).toContain("session_1");
      expect(stale).toContain("session_2");
      expect(stale).toContain("session_3");
    });
  });

  describe("reconnect rate tracking", () => {
    it("calculates reconnect rate correctly", () => {
      monitor.onConnect("session_1");

      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(1000);
        monitor.onConnect("session_1");
      }

      expect(monitor.getReconnectRate("session_1")).toBe(5);
    });

    it("resets rate after an hour", () => {
      monitor.onConnect("session_1");
      monitor.onConnect("session_1");
      expect(monitor.getReconnectRate("session_1")).toBe(1);

      vi.advanceTimersByTime(3_600_001);
      expect(monitor.getReconnectRate("session_1")).toBe(0);
    });

    it("returns 0 for unknown session", () => {
      expect(monitor.getReconnectRate("nonexistent")).toBe(0);
    });
  });

  describe("rate limiting", () => {
    it("identifies rate-limited sessions", () => {
      monitor.onConnect("session_1");

      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(1000);
        monitor.onConnect("session_1");
      }

      expect(monitor.isRateLimited("session_1")).toBe(true);
    });

    it("does not rate-limit sessions below threshold", () => {
      monitor.onConnect("session_1");

      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(1000);
        monitor.onConnect("session_1");
      }

      expect(monitor.isRateLimited("session_1")).toBe(false);
    });

    it("returns false for unknown session", () => {
      expect(monitor.isRateLimited("nonexistent")).toBe(false);
    });
  });

  describe("getHealthStatus", () => {
    it("returns correct counts", () => {
      monitor.onConnect("session_1");
      monitor.onConnect("session_2");
      monitor.onConnect("session_3");

      vi.advanceTimersByTime(65_000);
      monitor.evaluateHealth();

      const status = monitor.getHealthStatus();
      expect(status.total).toBe(3);
      expect(status.stale).toBe(3);
      expect(status.healthy).toBe(0);
    });

    it("includes connection details", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(30_000);

      const status = monitor.getHealthStatus();
      expect(status.connections).toHaveLength(1);
      expect(status.connections[0]).toMatchObject({
        sessionId: "session_1",
        isStale: false,
        reconnectCount: 0,
        isRateLimited: false,
      });
      expect(status.connections[0].timeSinceLastEventMs).toBeGreaterThan(29_000);
    });

    it("returns empty status when no connections", () => {
      const status = monitor.getHealthStatus();
      expect(status.total).toBe(0);
      expect(status.stale).toBe(0);
      expect(status.healthy).toBe(0);
      expect(status.connections).toEqual([]);
    });
  });

  describe("start/stop", () => {
    it("starts periodic health checks", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      monitor.onConnect("session_1");
      vi.advanceTimersByTime(65_000);

      monitor.start();
      vi.advanceTimersByTime(15_000); // Check interval

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Detected 1 stale connections"),
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });

    it("stops periodic health checks", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      monitor.start();
      monitor.stop();

      monitor.onConnect("session_1");
      vi.advanceTimersByTime(65_000);
      vi.advanceTimersByTime(15_000);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("does not start multiple intervals", () => {
      monitor.start();
      monitor.start();
      monitor.start();

      // Should only log once per interval
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      monitor.onConnect("session_1");
      vi.advanceTimersByTime(65_000);
      vi.advanceTimersByTime(15_000);

      expect(consoleSpy).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });
  });

  describe("getConfig", () => {
    it("returns current configuration", () => {
      const config = monitor.getConfig();
      expect(config).toEqual({
        staleThresholdMs: 60_000,
        checkIntervalMs: 15_000,
        maxReconnectsPerHour: 10,
        gracePeriodMs: 5_000,
      });
    });

    it("returns a copy, not the original", () => {
      const config = monitor.getConfig();
      config.staleThresholdMs = 999;

      expect(monitor.getConfig().staleThresholdMs).toBe(60_000);
    });
  });

  describe("clear", () => {
    it("removes all tracked connections", () => {
      monitor.onConnect("session_1");
      monitor.onConnect("session_2");
      expect(monitor.getHealthStatus().total).toBe(2);

      monitor.clear();
      expect(monitor.getHealthStatus().total).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("handles rapid connect/disconnect cycles", () => {
      for (let i = 0; i < 100; i++) {
        monitor.onConnect("session_1");
        vi.advanceTimersByTime(100);
        monitor.onDisconnect("session_1");
      }

      expect(monitor.getHealthStatus().total).toBe(0);
    });

    it("handles many concurrent connections", () => {
      for (let i = 0; i < 1000; i++) {
        monitor.onConnect(`session_${i}`);
      }

      expect(monitor.getHealthStatus().total).toBe(1000);
      expect(monitor.getHealthStatus().healthy).toBe(1000);
    });

    it("handles stale detection with zero threshold", () => {
      const zeroThresholdMonitor = new ConnectionHealthMonitor({
        staleThresholdMs: 0,
        gracePeriodMs: 0,
      });

      zeroThresholdMonitor.onConnect("session_1");
      vi.advanceTimersByTime(1);

      const stale = zeroThresholdMonitor.evaluateHealth();
      expect(stale).toContain("session_1");

      zeroThresholdMonitor.stop();
    });
  });

  describe("integration scenarios", () => {
    it("handles typical healthy session lifecycle", () => {
      // Connect
      monitor.onConnect("session_1");
      expect(monitor.getHealthStatus().healthy).toBe(1);

      // Regular activity
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(5_000);
        monitor.onEvent("session_1");
      }

      expect(monitor.getHealthStatus().healthy).toBe(1);
      expect(monitor.getStaleConnections()).not.toContain("session_1");

      // Clean disconnect
      monitor.onDisconnect("session_1");
      expect(monitor.getHealthStatus().total).toBe(0);
    });

    it("handles zombie session detection", () => {
      // Connect and become active
      monitor.onConnect("session_1");
      monitor.onEvent("session_1");

      // Client silently disconnects (no onDisconnect called)
      vi.advanceTimersByTime(65_000);

      // System detects staleness
      const stale = monitor.evaluateHealth();
      expect(stale).toContain("session_1");
      expect(monitor.getHealthStatus().stale).toBe(1);

      // SDK query continues running (we don't cancel it)
    });

    it("handles reconnection after staleness", () => {
      monitor.onConnect("session_1");
      vi.advanceTimersByTime(65_000);
      monitor.evaluateHealth();

      expect(monitor.getStaleConnections()).toContain("session_1");

      // Client reconnects
      monitor.onConnect("session_1");
      expect(monitor.getStaleConnections()).not.toContain("session_1");
      expect(monitor.getHealthStatus().healthy).toBe(1);
    });

    it("handles excessive reconnects leading to rate limit", () => {
      monitor.onConnect("session_1");

      // Simulate network flapping
      for (let i = 0; i < 15; i++) {
        vi.advanceTimersByTime(1000);
        monitor.onConnect("session_1");
      }

      expect(monitor.isRateLimited("session_1")).toBe(true);
      const status = monitor.getHealthStatus();
      expect(status.connections[0].isRateLimited).toBe(true);
    });
  });
});
