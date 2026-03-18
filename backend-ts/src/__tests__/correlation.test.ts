import { describe, it, expect } from "vitest";
import { generateCorrelationId, createCorrelationContext } from "../correlation.js";

describe("correlation", () => {
  describe("generateCorrelationId", () => {
    it("returns string with 'corr_' prefix", () => {
      const id = generateCorrelationId();
      expect(id).toMatch(/^corr_/);
    });

    it("returns unique IDs", () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
    });

    it("has valid UUID format after prefix", () => {
      const id = generateCorrelationId();
      const uuidPart = id.replace("corr_", "");
      // UUID v4 format: 8-4-4-4-12 hex characters
      expect(uuidPart).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe("createCorrelationContext", () => {
    it("returns valid context with all fields", () => {
      const sessionId = "session_123";
      const context = createCorrelationContext(sessionId);

      expect(context).toHaveProperty("correlationId");
      expect(context).toHaveProperty("sessionId");
      expect(context).toHaveProperty("startedAt");
      expect(context.sessionId).toBe(sessionId);
      expect(context.correlationId).toMatch(/^corr_/);
      expect(typeof context.startedAt).toBe("number");
    });

    it("sets startedAt to approximately Date.now()", () => {
      const before = Date.now();
      const context = createCorrelationContext("session_test");
      const after = Date.now();

      expect(context.startedAt).toBeGreaterThanOrEqual(before);
      expect(context.startedAt).toBeLessThanOrEqual(after);
    });

    it("generates unique correlationIds for each call", () => {
      const context1 = createCorrelationContext("session_1");
      const context2 = createCorrelationContext("session_1");

      expect(context1.correlationId).not.toBe(context2.correlationId);
    });
  });
});
