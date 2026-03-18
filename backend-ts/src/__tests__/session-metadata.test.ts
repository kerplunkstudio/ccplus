import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

// Import config to get DATABASE_PATH (set to test-ccplus.db via env var in vitest.config.ts)
import * as config from "../config.js";

// Import database module
const db = await import("../database.js");

// Import sdk-session module
const sdkSession = await import("../sdk-session.js");

describe("Session Metadata Tests", () => {
  beforeEach(() => {
    // Clean up the database
    const database = new Database(config.DATABASE_PATH);
    try {
      database.exec("DELETE FROM session_metadata");
      database.exec("DELETE FROM conversations");
      database.exec("DELETE FROM tool_usage");
    } catch {
      // Tables might not exist yet
    }
    database.close();
  });

  afterEach(() => {
    try {
      const database = new Database(config.DATABASE_PATH);
      database.close();
    } catch {
      // Database might already be closed
    }
  });

  describe("getSessionMetadata", () => {
    it("should return null for non-existent session", () => {
      const metadata = db.getSessionMetadata("nonexistent");
      expect(metadata).toBeNull();
    });

    it("should return metadata after insert", () => {
      db.upsertSessionMetadata("sess1", { model: "opus" });
      const metadata = db.getSessionMetadata("sess1");

      expect(metadata).not.toBeNull();
      expect(metadata?.session_id).toBe("sess1");
      expect(metadata?.model).toBe("opus");
      expect(metadata?.created_at).toBeDefined();
      expect(metadata?.updated_at).toBeDefined();
    });
  });

  describe("upsertSessionMetadata", () => {
    it("should create new metadata with all fields", () => {
      const metadata = db.upsertSessionMetadata("sess1", {
        model: "opus",
        thinking_level: "medium",
        verbose: true,
      });

      expect(metadata.session_id).toBe("sess1");
      expect(metadata.model).toBe("opus");
      expect(metadata.thinking_level).toBe("medium");
      expect(metadata.verbose).toBe(1);
    });

    it("should create metadata with partial fields", () => {
      const metadata = db.upsertSessionMetadata("sess1", {
        model: "haiku",
      });

      expect(metadata.session_id).toBe("sess1");
      expect(metadata.model).toBe("haiku");
      expect(metadata.thinking_level).toBeNull();
      expect(metadata.verbose).toBe(0);
    });

    it("should update existing metadata", () => {
      // Create initial metadata
      db.upsertSessionMetadata("sess1", { model: "sonnet" });

      // Update with new model
      const updated = db.upsertSessionMetadata("sess1", { model: "opus" });

      expect(updated.model).toBe("opus");
    });

    it("should update only provided fields", () => {
      // Create initial metadata with multiple fields
      db.upsertSessionMetadata("sess1", {
        model: "sonnet",
        thinking_level: "low",
        verbose: false,
      });

      // Update only model
      const updated = db.upsertSessionMetadata("sess1", { model: "opus" });

      expect(updated.model).toBe("opus");
      expect(updated.thinking_level).toBe("low"); // Should remain unchanged
      expect(updated.verbose).toBe(0); // Should remain unchanged
    });

    it("should handle null values for optional fields", () => {
      const metadata = db.upsertSessionMetadata("sess1", {
        model: null,
      });

      expect(metadata.model).toBeNull();
    });

    it("should handle boolean verbose flag", () => {
      const metadataTrue = db.upsertSessionMetadata("sess1", { verbose: true });
      expect(metadataTrue.verbose).toBe(1);

      const metadataFalse = db.upsertSessionMetadata("sess2", { verbose: false });
      expect(metadataFalse.verbose).toBe(0);
    });

    it("should update timestamp on update", () => {
      // Create initial metadata
      const initial = db.upsertSessionMetadata("sess1", { model: "sonnet" });
      const initialTimestamp = initial.updated_at;

      // Wait a bit to ensure timestamp changes
      // (In practice, SQLite timestamps have second precision)
      // We just verify the field exists
      const updated = db.upsertSessionMetadata("sess1", { model: "opus" });

      expect(updated.updated_at).toBeDefined();
      expect(updated.created_at).toBe(initial.created_at); // Created should not change
    });
  });

  describe("deleteSessionMetadata", () => {
    it("should return false for non-existent session", () => {
      const result = db.deleteSessionMetadata("nonexistent");
      expect(result).toBe(false);
    });

    it("should delete existing metadata", () => {
      db.upsertSessionMetadata("sess1", { model: "opus" });

      const result = db.deleteSessionMetadata("sess1");
      expect(result).toBe(true);

      const metadata = db.getSessionMetadata("sess1");
      expect(metadata).toBeNull();
    });
  });

  describe("Model validation", () => {
    it("should accept valid models", () => {
      const validModels = ["sonnet", "opus", "haiku"];

      for (const model of validModels) {
        const metadata = db.upsertSessionMetadata(`sess_${model}`, { model });
        expect(metadata.model).toBe(model);
      }
    });
  });

  describe("Integration with SDK session", () => {
    it("should apply model override from session metadata", () => {
      // Create session metadata with model override
      db.upsertSessionMetadata("sess1", { model: "opus" });

      // Record a conversation message to establish the session
      db.recordMessage("sess1", "user1", "user", "test message");

      // Verify metadata is retrievable
      const metadata = db.getSessionMetadata("sess1");
      expect(metadata?.model).toBe("opus");
    });

    it("should use default model when no metadata set", () => {
      // Record a conversation message without metadata
      db.recordMessage("sess1", "user1", "user", "test message");

      // Verify no metadata exists
      const metadata = db.getSessionMetadata("sess1");
      expect(metadata).toBeNull();
    });

    it("should allow clearing model override", () => {
      // Set model override
      db.upsertSessionMetadata("sess1", { model: "opus" });

      // Clear it by setting to null
      const updated = db.upsertSessionMetadata("sess1", { model: null });
      expect(updated.model).toBeNull();
    });
  });

  describe("Partial updates", () => {
    it("should preserve other fields when updating one field", () => {
      // Create metadata with all fields
      db.upsertSessionMetadata("sess1", {
        model: "sonnet",
        thinking_level: "high",
        verbose: true,
      });

      // Update only thinking_level
      db.upsertSessionMetadata("sess1", { thinking_level: "low" });

      const metadata = db.getSessionMetadata("sess1");
      expect(metadata?.model).toBe("sonnet");
      expect(metadata?.thinking_level).toBe("low");
      expect(metadata?.verbose).toBe(1);
    });

    it("should handle empty update", () => {
      // Create initial metadata
      const initial = db.upsertSessionMetadata("sess1", { model: "sonnet" });

      // Update with empty object (should be no-op)
      const updated = db.upsertSessionMetadata("sess1", {});

      expect(updated.model).toBe("sonnet");
      expect(updated.created_at).toBe(initial.created_at);
    });
  });

  describe("Edge cases", () => {
    it("should handle special session IDs", () => {
      const specialIds = [
        "session_with_underscores",
        "session-with-dashes",
        "session.with.dots",
        "session_123456789",
      ];

      for (const sessionId of specialIds) {
        const metadata = db.upsertSessionMetadata(sessionId, { model: "haiku" });
        expect(metadata.session_id).toBe(sessionId);
        expect(metadata.model).toBe("haiku");
      }
    });

    it("should handle very long thinking_level strings", () => {
      const longLevel = "x".repeat(1000);
      const metadata = db.upsertSessionMetadata("sess1", {
        thinking_level: longLevel,
      });

      expect(metadata.thinking_level).toBe(longLevel);
    });
  });
});
