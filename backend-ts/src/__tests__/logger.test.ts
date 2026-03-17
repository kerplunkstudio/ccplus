import { beforeEach, describe, it, expect, vi, afterEach } from "vitest";
import { log } from "../logger.js";

describe("Logger Tests", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console.log to capture output
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console.log
    consoleLogSpy.mockRestore();
    // Reset LOG_LEVEL to default
    delete process.env.LOG_LEVEL;
  });

  describe("log.info", () => {
    it("should output JSON with level, msg, and timestamp", () => {
      log.info("test message");

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(output.level).toBe("info");
      expect(output.msg).toBe("test message");
      expect(output.timestamp).toBeDefined();
      expect(new Date(output.timestamp as string).toISOString()).toBe(output.timestamp);
    });

    it("should include sessionId when provided in context", () => {
      log.info("test message", { sessionId: "session-123" });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-123");
    });

    it("should include extra context when provided", () => {
      log.info("test message", { workspace: "/tmp/workspace", model: "sonnet" });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.extra).toEqual({ workspace: "/tmp/workspace", model: "sonnet" });
    });

    it("should include both sessionId and extra context", () => {
      log.info("test message", { sessionId: "session-123", error: "some error", code: 500 });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-123");
      expect(output.extra).toEqual({ error: "some error", code: 500 });
    });

    it("should handle context with only sessionId (no extra)", () => {
      log.info("test message", { sessionId: "session-123" });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-123");
      expect(output.extra).toBeUndefined();
    });
  });

  describe("log.warn", () => {
    it("should output JSON with level 'warn'", () => {
      log.warn("warning message");

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(output.level).toBe("warn");
      expect(output.msg).toBe("warning message");
      expect(output.timestamp).toBeDefined();
    });

    it("should include context when provided", () => {
      log.warn("warning message", { sessionId: "session-456", reason: "timeout" });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-456");
      expect(output.extra).toEqual({ reason: "timeout" });
    });
  });

  describe("log.error", () => {
    it("should output JSON with level 'error'", () => {
      log.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(output.level).toBe("error");
      expect(output.msg).toBe("error message");
      expect(output.timestamp).toBeDefined();
    });

    it("should include context when provided", () => {
      log.error("error message", { sessionId: "session-789", error: "connection failed", stack: "..." });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-789");
      expect(output.extra).toEqual({ error: "connection failed", stack: "..." });
    });
  });

  describe("log.debug", () => {
    it("should output JSON with level 'debug' when LOG_LEVEL is debug", async () => {
      process.env.LOG_LEVEL = "debug";
      // Need to re-import logger after changing env var
      vi.resetModules();
      const { log: debugLog } = await import("../logger.js");

      debugLog.debug("debug message");

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);

      expect(output.level).toBe("debug");
      expect(output.msg).toBe("debug message");
      expect(output.timestamp).toBeDefined();
    });

    it("should include context when provided", async () => {
      process.env.LOG_LEVEL = "debug";
      vi.resetModules();
      const { log: debugLog } = await import("../logger.js");

      debugLog.debug("debug message", { sessionId: "session-debug", details: "verbose" });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-debug");
      expect(output.extra).toEqual({ details: "verbose" });
    });

    it("should not output when LOG_LEVEL is info (default)", () => {
      log.debug("debug message");

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should not output when LOG_LEVEL is warn", async () => {
      process.env.LOG_LEVEL = "warn";
      vi.resetModules();
      const { log: warnLog } = await import("../logger.js");

      warnLog.debug("debug message");

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe("LOG_LEVEL filtering", () => {
    it("should filter debug messages at info level (default)", () => {
      log.debug("debug message");
      log.info("info message");
      log.warn("warn message");
      log.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
      const levels = consoleLogSpy.mock.calls.map(call => JSON.parse(call[0] as string).level);
      expect(levels).toEqual(["info", "warn", "error"]);
    });

    it("should filter debug and info messages at warn level", async () => {
      process.env.LOG_LEVEL = "warn";
      vi.resetModules();
      const { log: warnLog } = await import("../logger.js");

      warnLog.debug("debug message");
      warnLog.info("info message");
      warnLog.warn("warn message");
      warnLog.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      const levels = consoleLogSpy.mock.calls.map(call => JSON.parse(call[0] as string).level);
      expect(levels).toEqual(["warn", "error"]);
    });

    it("should filter debug, info, and warn messages at error level", async () => {
      process.env.LOG_LEVEL = "error";
      vi.resetModules();
      const { log: errorLog } = await import("../logger.js");

      errorLog.debug("debug message");
      errorLog.info("info message");
      errorLog.warn("warn message");
      errorLog.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.level).toBe("error");
    });

    it("should show all messages at debug level", async () => {
      process.env.LOG_LEVEL = "debug";
      vi.resetModules();
      const { log: debugLog } = await import("../logger.js");

      debugLog.debug("debug message");
      debugLog.info("info message");
      debugLog.warn("warn message");
      debugLog.error("error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(4);
      const levels = consoleLogSpy.mock.calls.map(call => JSON.parse(call[0] as string).level);
      expect(levels).toEqual(["debug", "info", "warn", "error"]);
    });

    it("should default to info level when LOG_LEVEL is invalid", async () => {
      process.env.LOG_LEVEL = "invalid-level";
      vi.resetModules();
      const { log: defaultLog } = await import("../logger.js");

      defaultLog.debug("debug message");
      defaultLog.info("info message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.level).toBe("info");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty context object", () => {
      log.info("test message", {});

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBeUndefined();
      expect(output.extra).toBeUndefined();
    });

    it("should handle context with null values", () => {
      log.info("test message", { sessionId: "session-123", value: null });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-123");
      expect(output.extra).toEqual({ value: null });
    });

    it("should handle context with undefined values", () => {
      log.info("test message", { sessionId: "session-123", value: undefined });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-123");
      expect(output.extra).toEqual({ value: undefined });
    });

    it("should handle context with complex objects", () => {
      const complexContext = {
        sessionId: "session-123",
        nested: { foo: "bar", num: 42 },
        arr: [1, 2, 3],
      };

      log.info("test message", complexContext);

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.sessionId).toBe("session-123");
      expect(output.extra).toEqual({
        nested: { foo: "bar", num: 42 },
        arr: [1, 2, 3],
      });
    });

    it("should handle messages with special characters", () => {
      log.info("test\nmessage\twith\nspecial\tchars");

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.msg).toBe("test\nmessage\twith\nspecial\tchars");
    });
  });
});
