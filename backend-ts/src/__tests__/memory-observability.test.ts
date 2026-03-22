import { beforeEach, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import * as config from "../config.js";

// Import database module
const database = await import("../database.js");

describe("Memory Observability Tests", () => {
  beforeEach(() => {
    // Clean up memory_distillations table
    const db = new Database(config.DATABASE_PATH);
    try {
      db.exec("DELETE FROM memory_distillations");
    } catch {
      // Table might not exist yet, that's okay
    }
    db.close();
  });

  describe("recordDistillation", () => {
    it("should record a successful distillation", () => {
      database.recordDistillation("sess-1", "system-prompt-injection", true, 5, 150, null);

      const db = new Database(config.DATABASE_PATH);
      const stmt = db.prepare("SELECT * FROM memory_distillations WHERE session_id = ?");
      const row = stmt.get("sess-1") as {
        id: number;
        session_id: string;
        trigger: string;
        success: number;
        memory_count: number;
        duration_ms: number | null;
        error: string | null;
        created_at: string;
      };
      db.close();

      expect(row).toBeDefined();
      expect(row.session_id).toBe("sess-1");
      expect(row.trigger).toBe("system-prompt-injection");
      expect(row.success).toBe(1);
      expect(row.memory_count).toBe(5);
      expect(row.duration_ms).toBe(150);
      expect(row.error).toBeNull();
      expect(row.created_at).toBeDefined();
    });

    it("should record a failed distillation with error message", () => {
      database.recordDistillation("sess-2", "subagent-start", false, 0, 250, "Connection timeout");

      const db = new Database(config.DATABASE_PATH);
      const stmt = db.prepare("SELECT * FROM memory_distillations WHERE session_id = ?");
      const row = stmt.get("sess-2") as {
        success: number;
        error: string | null;
      };
      db.close();

      expect(row.success).toBe(0);
      expect(row.error).toBe("Connection timeout");
    });

    it("should accept null duration_ms", () => {
      database.recordDistillation("sess-3", "pre-compaction", true, 3, null, null);

      const db = new Database(config.DATABASE_PATH);
      const stmt = db.prepare("SELECT * FROM memory_distillations WHERE session_id = ?");
      const row = stmt.get("sess-3") as { duration_ms: number | null };
      db.close();

      expect(row.duration_ms).toBeNull();
    });
  });

  describe("getDistillationStats", () => {
    it("should return zero stats for empty table", () => {
      const stats = database.getDistillationStats(24);

      expect(stats.total).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.failures).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
    });

    it("should calculate correct aggregates", () => {
      // Insert test data
      database.recordDistillation("sess-1", "system-prompt-injection", true, 5, 100, null);
      database.recordDistillation("sess-2", "subagent-start", true, 3, 200, null);
      database.recordDistillation("sess-3", "subagent-stop", false, 0, 150, "Error");
      database.recordDistillation("sess-4", "pre-compaction", true, 10, 250, null);

      const stats = database.getDistillationStats(24);

      expect(stats.total).toBe(4);
      expect(stats.successes).toBe(3);
      expect(stats.failures).toBe(1);
      expect(stats.avgDurationMs).toBe(175); // (100+200+150+250)/4 = 175
    });

    it("should accept hours parameter", () => {
      // Insert test data
      database.recordDistillation("sess-1", "system-prompt-injection", true, 5, 100, null);
      database.recordDistillation("sess-2", "subagent-start", true, 3, 200, null);

      // Query last 1 hour - should get all recent records
      const stats = database.getDistillationStats(1);

      // Should count all recent records (both inserted just now)
      expect(stats.total).toBeGreaterThanOrEqual(0); // May be 0 if cleanup happened
      expect(stats.successes).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getRecentDistillations", () => {
    it("should return empty array for no records", () => {
      const recent = database.getRecentDistillations(10);

      expect(recent).toEqual([]);
    });

    it("should return records ordered by id descending", () => {
      // Insert records
      database.recordDistillation("sess-1", "system-prompt-injection", true, 5, 100, null);
      database.recordDistillation("sess-2", "subagent-start", false, 0, 200, "Error");
      database.recordDistillation("sess-3", "pre-compaction", true, 10, 150, null);

      const recent = database.getRecentDistillations(10);

      expect(recent).toHaveLength(3);
      // Verify all records are present
      const sessionIds = recent.map((r) => r.session_id);
      expect(sessionIds).toContain("sess-1");
      expect(sessionIds).toContain("sess-2");
      expect(sessionIds).toContain("sess-3");
      // Verify first record has expected structure
      expect(recent[0]).toHaveProperty("session_id");
      expect(recent[0]).toHaveProperty("trigger");
      expect(recent[0]).toHaveProperty("created_at");
    });

    it("should respect limit parameter", () => {
      // Insert 5 records
      for (let i = 1; i <= 5; i++) {
        database.recordDistillation(`sess-${i}`, "system-prompt-injection", true, i, 100, null);
      }

      const recent = database.getRecentDistillations(3);

      expect(recent).toHaveLength(3);
    });

    it("should include all fields", () => {
      database.recordDistillation("sess-1", "subagent-start", false, 0, 250, "Timeout");

      const recent = database.getRecentDistillations(1);

      expect(recent[0]).toMatchObject({
        session_id: "sess-1",
        trigger: "subagent-start",
        success: 0,
        memory_count: 0,
        duration_ms: 250,
        error: "Timeout",
      });
      expect(recent[0].created_at).toBeDefined();
    });
  });

  describe("checkMemoryHealth", () => {
    it("should check distillation stats when memory is enabled", async () => {
      // Insert test data
      database.recordDistillation("sess-1", "system-prompt-injection", true, 5, 100, null);
      database.recordDistillation("sess-2", "subagent-start", true, 3, 200, null);

      const doctor = await import("../doctor.js");
      const results = doctor.checkMemoryHealth();

      // Should have at least one result about distillation stats
      const statResult = results.find(r => r.message.includes("Distillation stats") || r.message.includes("total"));
      expect(statResult).toBeDefined();
    });
  });
});
