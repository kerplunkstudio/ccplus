import { beforeEach, describe, expect, it } from "vitest";
import { EventLog, SessionEvent } from "../event-log.js";

describe("EventLog", () => {
  let eventLog: EventLog;

  beforeEach(() => {
    eventLog = new EventLog();
  });

  describe("append", () => {
    it("should return a SessionEvent with seq=1 on first append", () => {
      const event = eventLog.append("session-1", "tool_start", { tool: "bash" });

      expect(event.seq).toBe(1);
      expect(event.type).toBe("tool_start");
      expect(event.data).toEqual({ tool: "bash" });
    });

    it("should include a valid ISO timestamp on returned event", () => {
      const before = Date.now();
      const event = eventLog.append("session-1", "tool_start", {});
      const after = Date.now();

      const ts = new Date(event.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("should produce sequential seq numbers for the same session", () => {
      const e1 = eventLog.append("session-1", "tool_start", {});
      const e2 = eventLog.append("session-1", "tool_end", {});
      const e3 = eventLog.append("session-1", "message", { text: "hi" });

      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(2);
      expect(e3.seq).toBe(3);
    });

    it("should maintain independent sequence counters per session", () => {
      const a1 = eventLog.append("session-a", "tool_start", {});
      const b1 = eventLog.append("session-b", "tool_start", {});
      const a2 = eventLog.append("session-a", "tool_end", {});
      const b2 = eventLog.append("session-b", "tool_end", {});

      expect(a1.seq).toBe(1);
      expect(a2.seq).toBe(2);
      expect(b1.seq).toBe(1);
      expect(b2.seq).toBe(2);
    });

    it("should preserve arbitrary data shapes on the returned event", () => {
      const data = { nested: { key: "value" }, arr: [1, 2, 3], flag: true };
      const event = eventLog.append("session-1", "custom", data);

      expect(event.data).toEqual(data);
    });
  });

  describe("getEventsSince", () => {
    it("should return all events when afterSeq=0", () => {
      eventLog.append("session-1", "tool_start", { n: 1 });
      eventLog.append("session-1", "tool_end", { n: 2 });
      eventLog.append("session-1", "message", { n: 3 });

      const events = eventLog.getEventsSince("session-1", 0);

      expect(events).toHaveLength(3);
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    });

    it("should return only events after the given seq", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});
      eventLog.append("session-1", "c", {});
      eventLog.append("session-1", "d", {});

      const events = eventLog.getEventsSince("session-1", 2);

      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(3);
      expect(events[1].seq).toBe(4);
    });

    it("should return an empty array when afterSeq equals the last seq", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});

      const events = eventLog.getEventsSince("session-1", 2);

      expect(events).toHaveLength(0);
    });

    it("should return an empty array for an unknown session", () => {
      const events = eventLog.getEventsSince("nonexistent-session", 0);

      expect(events).toEqual([]);
    });

    it("should return events ordered by ascending seq", () => {
      eventLog.append("session-1", "first", {});
      eventLog.append("session-1", "second", {});
      eventLog.append("session-1", "third", {});

      const events = eventLog.getEventsSince("session-1", 0);

      const seqs = events.map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    });
  });

  describe("getLastSeq", () => {
    it("should return 0 for an unknown session", () => {
      expect(eventLog.getLastSeq("nonexistent-session")).toBe(0);
    });

    it("should return the current seq after appends", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});
      eventLog.append("session-1", "c", {});

      expect(eventLog.getLastSeq("session-1")).toBe(3);
    });

    it("should be independent per session", () => {
      eventLog.append("session-a", "a", {});
      eventLog.append("session-b", "a", {});
      eventLog.append("session-b", "b", {});

      expect(eventLog.getLastSeq("session-a")).toBe(1);
      expect(eventLog.getLastSeq("session-b")).toBe(2);
    });
  });

  describe("getOldestSeq", () => {
    it("should return 0 for an unknown session", () => {
      expect(eventLog.getOldestSeq("nonexistent-session")).toBe(0);
    });

    it("should return 1 for a session with no trimming", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});

      expect(eventLog.getOldestSeq("session-1")).toBe(1);
    });

    it("should return the seq of the oldest retained event after trimming", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", {});
      log.append("session-1", "b", {});
      log.append("session-1", "c", {});
      log.append("session-1", "d", {});
      log.append("session-1", "e", {});

      // maxEvents=3 means events 3,4,5 are kept; oldest is seq 3
      expect(log.getOldestSeq("session-1")).toBe(3);
    });
  });

  describe("max events trimming", () => {
    it("should keep only the last N events when maxEvents is exceeded", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", { n: 1 });
      log.append("session-1", "b", { n: 2 });
      log.append("session-1", "c", { n: 3 });
      log.append("session-1", "d", { n: 4 });
      log.append("session-1", "e", { n: 5 });

      const events = log.getEventsSince("session-1", 0);

      expect(events).toHaveLength(3);
    });

    it("should preserve original sequence numbers after trimming", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", {});
      log.append("session-1", "b", {});
      log.append("session-1", "c", {});
      log.append("session-1", "d", {});
      log.append("session-1", "e", {});

      const events = log.getEventsSince("session-1", 0);

      expect(events.map((e) => e.seq)).toEqual([3, 4, 5]);
    });

    it("should not trim when event count equals maxEvents", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", {});
      log.append("session-1", "b", {});
      log.append("session-1", "c", {});

      expect(log.getEventCount("session-1")).toBe(3);
    });

    it("should use default maxEvents of 500 when not specified", () => {
      const log = new EventLog();

      for (let i = 0; i < 500; i++) {
        log.append("session-1", "event", { i });
      }

      expect(log.getEventCount("session-1")).toBe(500);

      log.append("session-1", "event", { i: 500 });

      expect(log.getEventCount("session-1")).toBe(500);
    });
  });

  describe("clear", () => {
    it("should remove all events for the session", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});

      eventLog.clear("session-1");

      expect(eventLog.getEventCount("session-1")).toBe(0);
      expect(eventLog.getEventsSince("session-1", 0)).toEqual([]);
    });

    it("should reset seq counter to 0 after clear", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});

      eventLog.clear("session-1");

      expect(eventLog.getLastSeq("session-1")).toBe(0);
    });

    it("should allow seq to restart from 1 after clear", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});

      eventLog.clear("session-1");

      const event = eventLog.append("session-1", "c", {});
      expect(event.seq).toBe(1);
    });

    it("should not affect events for other sessions", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-2", "b", {});

      eventLog.clear("session-1");

      expect(eventLog.getEventCount("session-2")).toBe(1);
      expect(eventLog.getLastSeq("session-2")).toBe(1);
    });

    it("should be a no-op for an unknown session", () => {
      // Should not throw
      expect(() => eventLog.clear("nonexistent-session")).not.toThrow();
    });
  });

  describe("hasSession", () => {
    it("should return false for an unknown session", () => {
      expect(eventLog.hasSession("nonexistent-session")).toBe(false);
    });

    it("should return true after appending an event", () => {
      eventLog.append("session-1", "a", {});

      expect(eventLog.hasSession("session-1")).toBe(true);
    });

    it("should return false after clear", () => {
      eventLog.append("session-1", "a", {});

      eventLog.clear("session-1");

      expect(eventLog.hasSession("session-1")).toBe(false);
    });
  });

  describe("getEventCount", () => {
    it("should return 0 for an unknown session", () => {
      expect(eventLog.getEventCount("nonexistent-session")).toBe(0);
    });

    it("should return the correct count after appends", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});
      eventLog.append("session-1", "c", {});

      expect(eventLog.getEventCount("session-1")).toBe(3);
    });

    it("should return 0 after clear", () => {
      eventLog.append("session-1", "a", {});
      eventLog.append("session-1", "b", {});

      eventLog.clear("session-1");

      expect(eventLog.getEventCount("session-1")).toBe(0);
    });

    it("should respect trimming and return at most maxEvents", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", {});
      log.append("session-1", "b", {});
      log.append("session-1", "c", {});
      log.append("session-1", "d", {});

      expect(log.getEventCount("session-1")).toBe(3);
    });

    it("should be independent per session", () => {
      eventLog.append("session-a", "a", {});
      eventLog.append("session-b", "a", {});
      eventLog.append("session-b", "b", {});

      expect(eventLog.getEventCount("session-a")).toBe(1);
      expect(eventLog.getEventCount("session-b")).toBe(2);
    });
  });

  describe("fullResetRequired", () => {
    it("should return true when clientLastSeq < oldestSeq", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", {});
      log.append("session-1", "b", {});
      log.append("session-1", "c", {});
      log.append("session-1", "d", {});
      log.append("session-1", "e", {});

      // maxEvents=3 means events 3,4,5 are kept; oldest is seq 3
      // Client's last seq was 2, which fell off the buffer
      expect(log.fullResetRequired("session-1", 2)).toBe(true);
    });

    it("should return false when clientLastSeq >= oldestSeq", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", {});
      log.append("session-1", "b", {});
      log.append("session-1", "c", {});
      log.append("session-1", "d", {});
      log.append("session-1", "e", {});

      // Client's last seq was 3 or higher, still in buffer
      expect(log.fullResetRequired("session-1", 3)).toBe(false);
      expect(log.fullResetRequired("session-1", 4)).toBe(false);
      expect(log.fullResetRequired("session-1", 5)).toBe(false);
    });

    it("should return false when clientLastSeq is 0", () => {
      const log = new EventLog(3);

      log.append("session-1", "a", {});
      log.append("session-1", "b", {});
      log.append("session-1", "c", {});
      log.append("session-1", "d", {});

      // clientLastSeq=0 means fresh connection, no reset needed
      expect(log.fullResetRequired("session-1", 0)).toBe(false);
    });

    it("should return false for unknown session", () => {
      expect(eventLog.fullResetRequired("nonexistent-session", 10)).toBe(false);
    });
  });

  describe("buffer size requirements", () => {
    it("should support EventLog with maxEvents=2000", () => {
      const log = new EventLog(2000);

      for (let i = 0; i < 2001; i++) {
        log.append("session-1", "event", { i });
      }

      // Should trim to exactly 2000 events
      expect(log.getEventCount("session-1")).toBe(2000);
      // Oldest should be seq 2 (trimmed seq 1)
      expect(log.getOldestSeq("session-1")).toBe(2);
    });

    it("should not trigger trimming with 600 events when maxEvents=2000", () => {
      const log = new EventLog(2000);

      for (let i = 0; i < 600; i++) {
        log.append("session-1", "event", { i });
      }

      // No trimming should occur
      expect(log.getEventCount("session-1")).toBe(600);
      expect(log.getOldestSeq("session-1")).toBe(1);
    });

    it("should support catch-up after brief disconnect", () => {
      const log = new EventLog(2000);

      // Append 10 events
      for (let i = 0; i < 10; i++) {
        log.append("session-1", "event", { i });
      }

      // Client missed the last 5 events (has lastSeq=5)
      const catchUpEvents = log.getEventsSince("session-1", 5);

      expect(catchUpEvents).toHaveLength(5);
      expect(catchUpEvents.map(e => e.seq)).toEqual([6, 7, 8, 9, 10]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string as session id", () => {
      const event = eventLog.append("", "a", {});
      expect(event.seq).toBe(1);
      expect(eventLog.hasSession("")).toBe(true);
    });

    it("should handle empty data object", () => {
      const event = eventLog.append("session-1", "a", {});
      expect(event.data).toEqual({});
    });

    it("should handle concurrent appends to different sessions independently", () => {
      for (let i = 0; i < 5; i++) {
        eventLog.append("session-a", "event", { i });
        eventLog.append("session-b", "event", { i });
      }

      expect(eventLog.getLastSeq("session-a")).toBe(5);
      expect(eventLog.getLastSeq("session-b")).toBe(5);
      expect(eventLog.getEventCount("session-a")).toBe(5);
      expect(eventLog.getEventCount("session-b")).toBe(5);
    });

    it("should handle special characters in session id", () => {
      const sessionId = "session/with:special?chars&more=stuff";
      eventLog.append(sessionId, "a", {});
      expect(eventLog.hasSession(sessionId)).toBe(true);
      expect(eventLog.getLastSeq(sessionId)).toBe(1);
    });

    it("should handle special characters in event type", () => {
      const event = eventLog.append("session-1", "type:with/special-chars", { key: "value" });
      expect(event.type).toBe("type:with/special-chars");
    });

    it("should handle unicode in data values", () => {
      const data = { msg: "Hello \u4e16\u754c \uD83D\uDE80", key: "caf\u00e9" };
      const event = eventLog.append("session-1", "a", data);
      expect(event.data).toEqual(data);
    });
  });
});
