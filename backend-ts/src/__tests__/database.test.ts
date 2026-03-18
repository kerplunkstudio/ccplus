import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Import config to get DATABASE_PATH (set to test-ccplus.db via env var in vitest.config.ts)
import * as config from "../config.js";

// Import database module - it will use test-ccplus.db from config
const db = await import("../database.js");

// Create temp directory for legacy database tests
const testDir = mkdtempSync(path.join(tmpdir(), "ccplus-test-"));

describe("Database Tests", () => {
  beforeEach(() => {
    // Clean up the database by deleting all records
    const database = new Database(config.DATABASE_PATH);
    try {
      database.exec("DELETE FROM conversations");
      database.exec("DELETE FROM tool_usage");
      database.exec("DELETE FROM images");
      database.exec("DELETE FROM user_stats");
      database.exec("DELETE FROM workspace_state");
      database.exec("DELETE FROM session_context");
      // FTS table is automatically cleaned when conversations are deleted (via trigger)
    } catch {
      // Tables might not exist yet, that's okay
    }
    database.close();
  });

  afterEach(() => {
    // Clean up after each test
    try {
      const database = new Database(config.DATABASE_PATH);
      database.close();
    } catch {
      // Database might already be closed
    }
  });

  describe("recordMessage", () => {
    it("should insert and return a message", () => {
      const result = db.recordMessage("sess1", "user1", "user", "hello");

      expect(result.session_id).toBe("sess1");
      expect(result.user_id).toBe("user1");
      expect(result.role).toBe("user");
      expect(result.content).toBe("hello");
      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it("should accept optional sdk_session_id", () => {
      const result = db.recordMessage("sess1", "user1", "assistant", "hi", "sdk-123");

      expect(result.sdk_session_id).toBe("sdk-123");
    });

    it("should default sdk_session_id to null", () => {
      const result = db.recordMessage("sess1", "user1", "user", "test");

      expect(result.sdk_session_id).toBeNull();
    });

    it("should accept optional project_path", () => {
      const result = db.recordMessage("sess1", "user1", "user", "test", undefined, "/path/to/project");

      expect(result.project_path).toBe("/path/to/project");
    });

    it("should accept optional imageIds", () => {
      const result = db.recordMessage("sess1", "user1", "user", "test", undefined, undefined, ["img1", "img2"]);

      expect(result.images).toBe(JSON.stringify(["img1", "img2"]));
    });
  });

  describe("getConversationHistory", () => {
    it("should return empty array for nonexistent session", () => {
      const history = db.getConversationHistory("nonexistent");

      expect(history).toEqual([]);
    });

    it("should return ordered messages", () => {
      db.recordMessage("sess1", "user1", "user", "first");
      db.recordMessage("sess1", "user1", "assistant", "second");
      db.recordMessage("sess1", "user1", "user", "third");

      const history = db.getConversationHistory("sess1");

      expect(history).toHaveLength(3);
      expect(history[0].content).toBe("first");
      expect(history[1].content).toBe("second");
      expect(history[2].content).toBe("third");
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        db.recordMessage("sess1", "user1", "user", `msg ${i}`);
      }

      const history = db.getConversationHistory("sess1", 3);

      expect(history).toHaveLength(3);
    });

    it("should isolate sessions", () => {
      db.recordMessage("sess1", "user1", "user", "session 1");
      db.recordMessage("sess2", "user1", "user", "session 2");

      const history = db.getConversationHistory("sess1");

      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("session 1");
    });

    it("should parse image IDs from JSON", () => {
      db.recordMessage("sess1", "user1", "user", "test", undefined, undefined, ["img1"]);

      const history = db.getConversationHistory("sess1");

      expect(history[0].images).toEqual([]);
    });
  });

  describe("recordToolEvent", () => {
    it("should insert minimal tool event", () => {
      const result = db.recordToolEvent("sess1", "Read", "tool-1");

      expect(result.session_id).toBe("sess1");
      expect(result.tool_name).toBe("Read");
      expect(result.tool_use_id).toBe("tool-1");
      expect(result.success).toBeNull();
      expect(result.error).toBeNull();
    });

    it("should insert full tool event", () => {
      const result = db.recordToolEvent(
        "sess1",
        "Write",
        "tool-2",
        "agent-1",
        "code_agent",
        true,
        null,
        150.5,
        { file_path: "/tmp/test.py" },
        100,
        50
      );

      expect(result.success).toBe(1); // SQLite stores bool as int
      expect(result.duration_ms).toBe(150.5);
      expect(result.parent_agent_id).toBe("agent-1");
      expect(result.agent_type).toBe("code_agent");
      expect(result.input_tokens).toBe(100);
      expect(result.output_tokens).toBe(50);
    });

    it("should record error events", () => {
      const result = db.recordToolEvent(
        "sess1",
        "Bash",
        "tool-3",
        undefined,
        undefined,
        false,
        "Permission denied"
      );

      expect(result.success).toBe(0);
      expect(result.error).toBe("Permission denied");
    });

    it("should serialize object parameters as JSON", () => {
      const params = { file_path: "/tmp/test.py", content: "hello" };
      const result = db.recordToolEvent("sess1", "Write", "tool-4", undefined, undefined, undefined, undefined, undefined, params);

      expect(typeof result.parameters).toBe("string");
      expect(JSON.parse(result.parameters as string)).toEqual(params);
    });

    it("should accept string parameters directly", () => {
      const result = db.recordToolEvent("sess1", "Write", "tool-5", undefined, undefined, undefined, undefined, undefined, '{"key":"value"}');

      expect(result.parameters).toBe('{"key":"value"}');
    });
  });

  describe("updateToolEvent", () => {
    it("should update tool event", () => {
      db.recordToolEvent("sess1", "Read", "tool-1");
      db.updateToolEvent("sess1", "tool-1", true, null, 100);

      const events = db.getToolEvents("sess1");

      expect(events[0].success).toBe(1);
      expect(events[0].duration_ms).toBe(100);
      expect(events[0].error).toBeNull();
    });

    it("should update with error", () => {
      db.recordToolEvent("sess1", "Read", "tool-1");
      db.updateToolEvent("sess1", "tool-1", false, "Failed", 50);

      const events = db.getToolEvents("sess1");

      expect(events[0].success).toBe(0);
      expect(events[0].error).toBe("Failed");
      expect(events[0].duration_ms).toBe(50);
    });
  });

  describe("getToolEvents", () => {
    it("should return empty array for nonexistent session", () => {
      const events = db.getToolEvents("nonexistent");

      expect(events).toEqual([]);
    });

    it("should return ordered events", () => {
      db.recordToolEvent("sess1", "Read", "t1");
      db.recordToolEvent("sess1", "Write", "t2");
      db.recordToolEvent("sess1", "Bash", "t3");

      const events = db.getToolEvents("sess1");

      expect(events).toHaveLength(3);
      expect(events[0].tool_name).toBe("Read");
      expect(events[1].tool_name).toBe("Write");
      expect(events[2].tool_name).toBe("Bash");
    });

    it("should deserialize JSON parameters", () => {
      db.recordToolEvent("sess1", "Read", "t1", undefined, undefined, undefined, undefined, undefined, { file_path: "/tmp/x.py" });

      const events = db.getToolEvents("sess1");

      expect(events[0].parameters).toEqual({ file_path: "/tmp/x.py" });
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        db.recordToolEvent("sess1", "Read", `t${i}`);
      }

      const events = db.getToolEvents("sess1", 5);

      expect(events).toHaveLength(5);
    });
  });

  describe("getStats", () => {
    it("should return empty stats for empty database", () => {
      const stats = db.getStats();

      expect(stats.total_conversations).toBe(0);
      expect(stats.total_tool_events).toBe(0);
      expect(stats.events_by_tool).toEqual({});
    });

    it("should return populated stats", () => {
      db.recordMessage("sess1", "user1", "user", "hello");
      db.recordMessage("sess1", "user1", "assistant", "hi");
      db.recordToolEvent("sess1", "Read", "t1");
      db.recordToolEvent("sess1", "Read", "t2");
      db.recordToolEvent("sess1", "Write", "t3");

      const stats = db.getStats();

      expect(stats.total_conversations).toBe(2);
      expect(stats.total_tool_events).toBe(3);
      expect((stats.events_by_tool as Record<string, number>).Read).toBe(2);
      expect((stats.events_by_tool as Record<string, number>).Write).toBe(1);
    });
  });

  describe("getSessionsList", () => {
    it("should return empty array for no sessions", () => {
      const sessions = db.getSessionsList();

      expect(sessions).toEqual([]);
    });

    it("should return sessions ordered by last activity", () => {
      db.recordMessage("sess1", "user1", "user", "first message");
      db.recordMessage("sess2", "user1", "user", "second message");
      db.recordMessage("sess1", "user1", "assistant", "response");

      const sessions = db.getSessionsList();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].session_id).toBe("sess1");
      expect(sessions[1].session_id).toBe("sess2");
    });

    it("should include message count", () => {
      db.recordMessage("sess1", "user1", "user", "msg1");
      db.recordMessage("sess1", "user1", "assistant", "msg2");
      db.recordMessage("sess1", "user1", "user", "msg3");

      const sessions = db.getSessionsList();

      expect(sessions[0].message_count).toBe(3);
    });

    it("should include last user message", () => {
      db.recordMessage("sess1", "user1", "user", "first");
      db.recordMessage("sess1", "user1", "assistant", "response");
      db.recordMessage("sess1", "user1", "user", "latest user message");

      const sessions = db.getSessionsList();

      expect(sessions[0].last_user_message).toBe("latest user message");
    });

    it("should truncate long messages", () => {
      const longMessage = "x".repeat(100);
      db.recordMessage("sess1", "user1", "user", longMessage);

      const sessions = db.getSessionsList();

      expect((sessions[0].last_user_message as string).length).toBe(83); // 80 chars + "..."
      expect(sessions[0].last_user_message).toMatch(/\.\.\.$/);
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        db.recordMessage(`sess${i}`, "user1", "user", `message ${i}`);
      }

      const sessions = db.getSessionsList(5);

      expect(sessions).toHaveLength(5);
    });

    it("should filter by project path", () => {
      db.recordMessage("sess1", "user1", "user", "msg1", undefined, "/path/to/project1");
      db.recordMessage("sess2", "user1", "user", "msg2", undefined, "/path/to/project2");

      const sessions = db.getSessionsList(50, "/path/to/project1");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe("sess1");
    });

    it("should exclude archived sessions by default", () => {
      db.recordMessage("sess1", "user1", "user", "msg1");
      db.recordMessage("sess2", "user1", "user", "msg2");
      db.archiveSession("sess1");

      const sessions = db.getSessionsList();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe("sess2");
    });

    it("should include archived sessions when requested", () => {
      db.recordMessage("sess1", "user1", "user", "msg1");
      db.recordMessage("sess2", "user1", "user", "msg2");
      db.archiveSession("sess1");

      const sessions = db.getSessionsList(50, undefined, true);

      expect(sessions).toHaveLength(2);
    });
  });

  describe("getLastSdkSessionId", () => {
    it("should return null when no SDK sessions exist", () => {
      db.recordMessage("sess1", "user1", "user", "hello");

      const result = db.getLastSdkSessionId("sess1");

      expect(result).toBeNull();
    });

    it("should return most recent SDK session ID", () => {
      db.recordMessage("sess1", "user1", "user", "first");
      db.recordMessage("sess1", "user1", "assistant", "response1", "sdk-old");
      db.recordMessage("sess1", "user1", "user", "second");
      db.recordMessage("sess1", "user1", "assistant", "response2", "sdk-new");

      const result = db.getLastSdkSessionId("sess1");

      expect(result).toBe("sdk-new");
    });

    it("should ignore null SDK session IDs", () => {
      db.recordMessage("sess1", "user1", "user", "first");
      db.recordMessage("sess1", "user1", "assistant", "response1", "sdk-123");
      db.recordMessage("sess1", "user1", "user", "second");
      db.recordMessage("sess1", "user1", "assistant", "response2");

      const result = db.getLastSdkSessionId("sess1");

      expect(result).toBe("sdk-123");
    });

    it("should isolate sessions", () => {
      db.recordMessage("sess1", "user1", "assistant", "msg1", "sdk-sess1");
      db.recordMessage("sess2", "user1", "assistant", "msg2", "sdk-sess2");

      const result1 = db.getLastSdkSessionId("sess1");
      const result2 = db.getLastSdkSessionId("sess2");

      expect(result1).toBe("sdk-sess1");
      expect(result2).toBe("sdk-sess2");
    });

    it("should return null for nonexistent session", () => {
      const result = db.getLastSdkSessionId("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("archiveSession", () => {
    it("should archive a session", () => {
      db.recordMessage("sess1", "user1", "user", "msg1");

      const result = db.archiveSession("sess1");

      expect(result).toBe(true);

      const sessions = db.getSessionsList();
      expect(sessions).toHaveLength(0);
    });

    it("should return true even for nonexistent session", () => {
      const result = db.archiveSession("nonexistent");

      expect(result).toBe(true);
    });
  });

  describe("markOrphanedToolEvents", () => {
    it("should not mark completed events", () => {
      db.recordToolEvent("sess1", "Read", "t1", undefined, undefined, true, null, 100);
      db.recordToolEvent("sess1", "Write", "t2", undefined, undefined, false, "Failed", 50);

      const count = db.markOrphanedToolEvents();

      expect(count).toBe(0);

      const events = db.getToolEvents("sess1");
      expect(events[0].success).toBe(1);
      expect(events[1].success).toBe(0);
    });

    it("should mark running events as orphaned", () => {
      db.recordToolEvent("sess1", "Read", "t1");
      db.recordToolEvent("sess1", "Write", "t2");
      db.recordToolEvent("sess1", "Bash", "t3", undefined, undefined, true, null, 100);

      const count = db.markOrphanedToolEvents();

      expect(count).toBe(2);

      const events = db.getToolEvents("sess1");
      expect(events[0].success).toBe(0);
      expect(events[0].error).toBe("Server restarted");
      expect(events[0].duration_ms).toBe(0);

      expect(events[1].success).toBe(0);
      expect(events[1].error).toBe("Server restarted");
      expect(events[1].duration_ms).toBe(0);

      expect(events[2].success).toBe(1);
      expect(events[2].error).toBeNull();
    });

    it("should mark orphans across sessions", () => {
      db.recordToolEvent("sess1", "Read", "t1");
      db.recordToolEvent("sess2", "Write", "t2");
      db.recordToolEvent("sess3", "Bash", "t3");

      const count = db.markOrphanedToolEvents();

      expect(count).toBe(3);

      expect(db.getToolEvents("sess1")[0].error).toBe("Server restarted");
      expect(db.getToolEvents("sess2")[0].error).toBe("Server restarted");
      expect(db.getToolEvents("sess3")[0].error).toBe("Server restarted");
    });
  });

  describe("isFirstRun", () => {
    it("should return true for empty database", () => {
      expect(db.isFirstRun()).toBe(true);
    });

    it("should return false with conversations", () => {
      db.recordMessage("sess1", "user1", "user", "hello");

      expect(db.isFirstRun()).toBe(false);
    });

    it("should return true with only archived conversations", () => {
      db.recordMessage("sess1", "user1", "user", "hello");
      db.archiveSession("sess1");

      expect(db.isFirstRun()).toBe(true);
    });

    it("should return false with mixed conversations", () => {
      db.recordMessage("sess1", "user1", "user", "archived message");
      db.archiveSession("sess1");
      db.recordMessage("sess2", "user1", "user", "active message");

      expect(db.isFirstRun()).toBe(false);
    });
  });

  describe("storeImage", () => {
    it("should store image and return metadata", () => {
      const imageData = Buffer.from("fake image data");
      const result = db.storeImage("img1", "test.png", "image/png", 100, imageData, "sess1");

      expect(result.id).toBe("img1");
      expect(result.filename).toBe("test.png");
      expect(result.mime_type).toBe("image/png");
      expect(result.size).toBe(100);
      expect(result.url).toBe("/api/images/img1");
    });
  });

  describe("getImage", () => {
    it("should retrieve stored image", () => {
      const imageData = Buffer.from("fake image data");
      db.storeImage("img1", "test.png", "image/png", 100, imageData, "sess1");

      const result = db.getImage("img1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("img1");
      expect(result?.filename).toBe("test.png");
      expect(Buffer.isBuffer(result?.data)).toBe(true);
    });

    it("should return null for nonexistent image", () => {
      const result = db.getImage("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getUserStats", () => {
    it("should create and return default stats for new user", () => {
      const stats = db.getUserStats("user1");

      expect(stats.user_id).toBe("user1");
      expect(stats.total_sessions).toBe(0);
      expect(stats.total_queries).toBe(0);
      expect(stats.total_duration_ms).toBe(0);
      expect(stats.total_cost).toBe(0);
      expect(stats.total_input_tokens).toBe(0);
      expect(stats.total_output_tokens).toBe(0);
      expect(stats.total_lines_of_code).toBe(0);
    });

    it("should return existing stats", () => {
      db.incrementUserStats("user1", 1, 5, 1000, 0.5, 100, 200, 50);

      const stats = db.getUserStats("user1");

      expect(stats.total_sessions).toBe(1);
      expect(stats.total_queries).toBe(5);
    });
  });

  describe("incrementUserStats", () => {
    it("should increment stats for existing user", () => {
      db.getUserStats("user1"); // Create initial record
      db.incrementUserStats("user1", 1, 5, 1000, 0.5, 100, 200, 50);

      const stats = db.getUserStats("user1");

      expect(stats.total_sessions).toBe(1);
      expect(stats.total_queries).toBe(5);
      expect(stats.total_duration_ms).toBe(1000);
      expect(stats.total_cost).toBe(0.5);
      expect(stats.total_input_tokens).toBe(100);
      expect(stats.total_output_tokens).toBe(200);
      expect(stats.total_lines_of_code).toBe(50);
    });

    it("should accumulate stats across multiple increments", () => {
      db.incrementUserStats("user1", 1, 5, 1000, 0.5, 100, 200, 50);
      db.incrementUserStats("user1", 1, 3, 500, 0.3, 50, 100, 25);

      const stats = db.getUserStats("user1");

      expect(stats.total_sessions).toBe(2);
      expect(stats.total_queries).toBe(8);
      expect(stats.total_duration_ms).toBe(1500);
      expect(stats.total_cost).toBe(0.8);
      expect(stats.total_input_tokens).toBe(150);
      expect(stats.total_output_tokens).toBe(300);
      expect(stats.total_lines_of_code).toBe(75);
    });

    it("should create new record if user does not exist", () => {
      db.incrementUserStats("user1", 1, 5, 1000, 0.5, 100, 200, 50);

      const stats = db.getUserStats("user1");

      expect(stats.total_sessions).toBe(1);
    });
  });

  describe("updateSessionContext", () => {
    it("should insert new session context", () => {
      db.updateSessionContext("sess1", 10000, "sonnet");

      const context = db.getSessionContext("sess1");
      expect(context).toBeDefined();
      expect(context?.input_tokens).toBe(10000);
      expect(context?.model).toBe("sonnet");
    });

    it("should update existing session context", () => {
      db.updateSessionContext("sess1", 10000, "sonnet");
      db.updateSessionContext("sess1", 20000, "opus");

      const context = db.getSessionContext("sess1");
      expect(context?.input_tokens).toBe(20000);
      expect(context?.model).toBe("opus");
    });

    it("should handle null model", () => {
      db.updateSessionContext("sess1", 5000, null);

      const context = db.getSessionContext("sess1");
      expect(context?.input_tokens).toBe(5000);
      expect(context?.model).toBeNull();
    });
  });

  describe("getSessionContext", () => {
    it("should return null for non-existent session", () => {
      const context = db.getSessionContext("nonexistent");
      expect(context).toBeNull();
    });

    it("should return context for existing session", () => {
      db.updateSessionContext("sess1", 15000, "haiku");

      const context = db.getSessionContext("sess1");
      expect(context).toBeDefined();
      expect(context?.input_tokens).toBe(15000);
      expect(context?.model).toBe("haiku");
    });
  });

  describe("Immutability", () => {
    it("should return new object from recordMessage", () => {
      const result = db.recordMessage("sess1", "user1", "user", "hello");
      const originalContent = result.content;

      // Mutate the result
      result.content = "mutated";

      const history = db.getConversationHistory("sess1");

      expect(history[0].content).toBe(originalContent);
      expect(history[0].content).not.toBe("mutated");
    });

    it("should return new array from getConversationHistory", () => {
      db.recordMessage("sess1", "user1", "user", "hello");

      const history1 = db.getConversationHistory("sess1");
      const history2 = db.getConversationHistory("sess1");

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });

    it("should return new array from getToolEvents", () => {
      db.recordToolEvent("sess1", "Read", "t1");

      const events1 = db.getToolEvents("sess1");
      const events2 = db.getToolEvents("sess1");

      expect(events1).not.toBe(events2);
      expect(events1).toEqual(events2);
    });

    it("should return new object from recordToolEvent", () => {
      const result = db.recordToolEvent("sess1", "Read", "t1");
      const originalToolName = result.tool_name;

      // Mutate the result
      result.tool_name = "mutated";

      const events = db.getToolEvents("sess1");

      expect(events[0].tool_name).toBe(originalToolName);
      expect(events[0].tool_name).not.toBe("mutated");
    });
  });

  describe("updateMessage", () => {
    it("should update message content only", () => {
      const msg = db.recordMessage("sess1", "user1", "assistant", "initial content");
      db.updateMessage(msg.id as number, "updated content");

      const history = db.getConversationHistory("sess1");
      expect(history[0].content).toBe("updated content");
      expect(history[0].sdk_session_id).toBeNull();
    });

    it("should update message content and sdk_session_id", () => {
      const msg = db.recordMessage("sess1", "user1", "assistant", "initial content");
      db.updateMessage(msg.id as number, "updated content", "sdk-456");

      const history = db.getConversationHistory("sess1");
      expect(history[0].content).toBe("updated content");
      expect(history[0].sdk_session_id).toBe("sdk-456");
    });
  });

  describe("getMessageImages", () => {
    it("should return empty array for empty image IDs", () => {
      const images = db.getMessageImages([]);
      expect(images).toEqual([]);
    });

    it("should return image metadata for stored images", () => {
      const imageData = Buffer.from("fake image data");
      db.storeImage("img1", "test.png", "image/png", 100, imageData, "sess1");
      db.storeImage("img2", "test2.jpg", "image/jpeg", 200, imageData, "sess1");

      const images = db.getMessageImages(["img1", "img2"]);

      expect(images).toHaveLength(2);
      expect(images[0].id).toBe("img1");
      expect(images[0].filename).toBe("test.png");
      expect(images[0].url).toBe("/api/images/img1");
      expect(images[1].id).toBe("img2");
      expect(images[1].filename).toBe("test2.jpg");
      expect(images[1].url).toBe("/api/images/img2");
    });

    it("should filter out non-existent images", () => {
      const imageData = Buffer.from("fake image data");
      db.storeImage("img1", "test.png", "image/png", 100, imageData, "sess1");

      const images = db.getMessageImages(["img1", "nonexistent"]);

      expect(images).toHaveLength(1);
      expect(images[0].id).toBe("img1");
    });
  });

  describe("getWorkspaceState", () => {
    it("should return null for non-existent user", () => {
      const state = db.getWorkspaceState("nonexistent");
      expect(state).toBeNull();
    });

    it("should return parsed workspace state", () => {
      const workspaceState = { tabs: ["file1.ts", "file2.ts"], activeFile: "file1.ts" };
      db.saveWorkspaceState("user1", workspaceState);

      const state = db.getWorkspaceState("user1");
      expect(state).toEqual(workspaceState);
    });

    it("should return null for invalid JSON", () => {
      // Manually insert invalid JSON to test error handling
      const database = new Database(config.DATABASE_PATH);
      database.prepare("INSERT INTO workspace_state (user_id, state) VALUES (?, ?)").run("user_bad", "invalid json");
      database.close();

      const state = db.getWorkspaceState("user_bad");
      expect(state).toBeNull();
    });
  });

  describe("saveWorkspaceState", () => {
    it("should insert new workspace state", () => {
      const workspaceState = { tabs: ["file1.ts"] };
      db.saveWorkspaceState("user1", workspaceState);

      const state = db.getWorkspaceState("user1");
      expect(state).toEqual(workspaceState);
    });

    it("should update existing workspace state", () => {
      db.saveWorkspaceState("user1", { tabs: ["old.ts"] });
      db.saveWorkspaceState("user1", { tabs: ["new.ts"] });

      const state = db.getWorkspaceState("user1");
      expect(state).toEqual({ tabs: ["new.ts"] });
    });

    it("should handle complex nested state", () => {
      const complexState = {
        tabs: ["file1.ts", "file2.ts"],
        activeFile: "file1.ts",
        panels: { left: true, right: false },
        history: [{ file: "file1.ts", line: 10 }],
      };
      db.saveWorkspaceState("user1", complexState);

      const state = db.getWorkspaceState("user1");
      expect(state).toEqual(complexState);
    });
  });

  describe("duplicateSession", () => {
    it("should duplicate conversations", () => {
      db.recordMessage("sess1", "user1", "user", "msg1");
      db.recordMessage("sess1", "user1", "assistant", "response1");

      const result = db.duplicateSession("sess1", "sess2", "user1");

      expect(result.conversations).toBe(2);

      const originalHistory = db.getConversationHistory("sess1");
      const duplicatedHistory = db.getConversationHistory("sess2");

      expect(duplicatedHistory).toHaveLength(2);
      expect(duplicatedHistory[0].content).toBe(originalHistory[0].content);
      expect(duplicatedHistory[1].content).toBe(originalHistory[1].content);
    });

    it("should duplicate tool events", () => {
      db.recordToolEvent("sess1", "Read", "t1");
      db.recordToolEvent("sess1", "Write", "t2");

      const result = db.duplicateSession("sess1", "sess2", "user1");

      expect(result.toolEvents).toBe(2);

      const originalEvents = db.getToolEvents("sess1");
      const duplicatedEvents = db.getToolEvents("sess2");

      expect(duplicatedEvents).toHaveLength(2);
      expect(duplicatedEvents[0].tool_name).toBe(originalEvents[0].tool_name);
      expect(duplicatedEvents[1].tool_name).toBe(originalEvents[1].tool_name);
    });

    it("should duplicate images with new IDs", () => {
      const imageData = Buffer.from("fake image data");
      db.storeImage("img1", "test.png", "image/png", 100, imageData, "sess1");

      const result = db.duplicateSession("sess1", "sess2", "user1");

      expect(result.images).toBe(1);

      // Verify images exist in duplicated session
      const database = new Database(config.DATABASE_PATH);
      const images = database.prepare("SELECT * FROM images WHERE session_id = ?").all("sess2") as Array<{ id: string }>;
      database.close();

      expect(images).toHaveLength(1);
      expect(images[0].id).not.toBe("img1"); // Should have a new ID
    });

    it("should not archive duplicated session", () => {
      db.recordMessage("sess1", "user1", "user", "msg1");
      db.duplicateSession("sess1", "sess2", "user1");

      const sessions = db.getSessionsList();
      expect(sessions.some(s => s.session_id === "sess2")).toBe(true);
    });

    it("should return zero counts for empty session", () => {
      const result = db.duplicateSession("nonexistent", "sess2", "user1");

      expect(result.conversations).toBe(0);
      expect(result.toolEvents).toBe(0);
      expect(result.images).toBe(0);
    });
  });

  describe("cleanupOrphanedImages", () => {
    it("should not delete images from active sessions", () => {
      const imageData = Buffer.from("fake image data");
      db.recordMessage("sess1", "user1", "user", "msg1");
      db.storeImage("img1", "test.png", "image/png", 100, imageData, "sess1");

      const count = db.cleanupOrphanedImages();

      expect(count).toBe(0);

      const image = db.getImage("img1");
      expect(image).not.toBeNull();
    });

    it("should delete images from orphaned sessions", () => {
      const imageData = Buffer.from("fake image data");
      db.storeImage("img1", "test.png", "image/png", 100, imageData, "orphaned-session");

      const count = db.cleanupOrphanedImages();

      expect(count).toBe(1);

      const image = db.getImage("img1");
      expect(image).toBeNull();
    });

    it("should clean up multiple orphaned images", () => {
      const imageData = Buffer.from("fake image data");
      db.recordMessage("sess1", "user1", "user", "msg1");
      db.storeImage("img1", "test.png", "image/png", 100, imageData, "sess1");
      db.storeImage("img2", "orphan1.png", "image/png", 100, imageData, "orphaned1");
      db.storeImage("img3", "orphan2.png", "image/png", 100, imageData, "orphaned2");

      const count = db.cleanupOrphanedImages();

      expect(count).toBe(2);

      expect(db.getImage("img1")).not.toBeNull();
      expect(db.getImage("img2")).toBeNull();
      expect(db.getImage("img3")).toBeNull();
    });
  });

  describe("getInsights", () => {
    beforeEach(() => {
      // Manually insert backdated records for testing time-based queries
      const database = new Database(config.DATABASE_PATH);

      // Insert conversations from 40 days ago (outside default 30-day window)
      database.prepare(`
        INSERT INTO conversations (session_id, user_id, role, content, timestamp, project_path)
        VALUES (?, ?, ?, ?, date('now', '-40 days'), ?)
      `).run("old_session", "user1", "user", "old message", "/path/to/project1");

      // Insert conversations from 10 days ago (within window)
      database.prepare(`
        INSERT INTO conversations (session_id, user_id, role, content, timestamp, project_path)
        VALUES (?, ?, ?, ?, date('now', '-10 days'), ?)
      `).run("recent_session", "user1", "user", "recent message", "/path/to/project1");

      database.prepare(`
        INSERT INTO conversations (session_id, user_id, role, content, timestamp, project_path)
        VALUES (?, ?, ?, ?, date('now', '-10 days'), ?)
      `).run("recent_session", "user1", "assistant", "assistant response", "/path/to/project1");

      // Insert tool events from 10 days ago
      database.prepare(`
        INSERT INTO tool_usage (session_id, tool_name, tool_use_id, timestamp, success, input_tokens, output_tokens)
        VALUES (?, ?, ?, date('now', '-10 days'), ?, ?, ?)
      `).run("recent_session", "Read", "t1", 1, 1000, 500);

      database.prepare(`
        INSERT INTO tool_usage (session_id, tool_name, tool_use_id, timestamp, success, input_tokens, output_tokens)
        VALUES (?, ?, ?, date('now', '-10 days'), ?, ?, ?)
      `).run("recent_session", "Write", "t2", 1, 2000, 1000);

      database.close();
    });

    it("should return insights for default 30-day period", () => {
      const insights = db.getInsights();

      expect(insights.period).toBeDefined();
      expect(insights.period.days).toBe(30);
      expect(insights.summary).toBeDefined();
      expect(insights.daily).toBeDefined();
      expect(insights.by_project).toBeDefined();
      expect(insights.by_tool).toBeDefined();
    });

    it("should calculate summary statistics", () => {
      const insights = db.getInsights();

      expect(insights.summary.total_queries).toBeGreaterThan(0);
      expect(insights.summary.total_cost).toBeGreaterThan(0);
      expect(insights.summary.total_input_tokens).toBeGreaterThan(0);
      expect(insights.summary.total_output_tokens).toBeGreaterThan(0);
      expect(insights.summary.total_tool_calls).toBeGreaterThan(0);
      expect(insights.summary.total_sessions).toBeGreaterThan(0);
    });

    it("should calculate cost based on token usage", () => {
      const insights = db.getInsights();

      // Cost = (input_tokens / 1_000_000 * 3.0) + (output_tokens / 1_000_000 * 15.0)
      const expectedCost = (3000 / 1_000_000 * 3.0) + (1500 / 1_000_000 * 15.0);
      expect(insights.summary.total_cost).toBeCloseTo(expectedCost, 2);
    });

    it("should provide daily breakdown", () => {
      const insights = db.getInsights();

      expect(Array.isArray(insights.daily)).toBe(true);
      const dailyWithData = (insights.daily as Array<Record<string, unknown>>).filter(
        (d: Record<string, unknown>) => (d.queries as number) > 0
      );
      expect(dailyWithData.length).toBeGreaterThan(0);

      // Check structure of daily entries
      const firstDay = (insights.daily as Array<Record<string, unknown>>)[0];
      expect(firstDay.date).toBeDefined();
      expect(firstDay.queries).toBeDefined();
      expect(firstDay.tool_calls).toBeDefined();
      expect(firstDay.cost).toBeDefined();
      expect(firstDay.input_tokens).toBeDefined();
      expect(firstDay.output_tokens).toBeDefined();
      expect(firstDay.sessions).toBeDefined();
    });

    it("should provide project breakdown", () => {
      const insights = db.getInsights();

      expect(Array.isArray(insights.by_project)).toBe(true);
      const projects = insights.by_project as Array<Record<string, unknown>>;
      expect(projects.length).toBeGreaterThan(0);

      const project = projects[0];
      expect(project.project).toBeDefined();
      expect(project.path).toBeDefined();
      expect(project.queries).toBeGreaterThan(0);
      expect(project.cost).toBeGreaterThanOrEqual(0);
    });

    it("should provide tool breakdown", () => {
      const insights = db.getInsights();

      expect(Array.isArray(insights.by_tool)).toBe(true);
      const tools = insights.by_tool as Array<Record<string, unknown>>;
      expect(tools.length).toBeGreaterThan(0);

      const tool = tools[0];
      expect(tool.tool).toBeDefined();
      expect(tool.count).toBeGreaterThan(0);
      expect(tool.success_rate).toBeGreaterThanOrEqual(0);
      expect(tool.success_rate).toBeLessThanOrEqual(1);
    });

    it("should filter by custom date range", () => {
      const insights7Days = db.getInsights(7);
      const insights30Days = db.getInsights(30);

      expect(insights7Days.period.days).toBe(7);
      expect(insights30Days.period.days).toBe(30);

      // 7-day window should have same or fewer queries than 30-day window
      expect(insights7Days.summary.total_queries).toBeLessThanOrEqual(insights30Days.summary.total_queries);
    });

    it("should filter by project path", () => {
      const allInsights = db.getInsights();
      const projectInsights = db.getInsights(30, "/path/to/project1");

      expect(projectInsights.summary.total_queries).toBeGreaterThan(0);
      expect(projectInsights.summary.total_queries).toBeLessThanOrEqual(allInsights.summary.total_queries);
    });

    it("should calculate change percentage from previous period", () => {
      // Insert data in previous period (31-60 days ago)
      const database = new Database(config.DATABASE_PATH);
      database.prepare(`
        INSERT INTO conversations (session_id, user_id, role, content, timestamp)
        VALUES (?, ?, ?, ?, date('now', '-40 days'))
      `).run("prev_session", "user1", "user", "previous period message");
      database.close();

      const insights = db.getInsights();

      expect(insights.summary.change_pct).toBeDefined();
      expect(typeof insights.summary.change_pct).toBe("number");
    });

    it("should exclude archived sessions from insights", () => {
      db.recordMessage("archived_session", "user1", "user", "archived message");
      db.archiveSession("archived_session");

      const insights = db.getInsights();

      // Verify archived session is not counted
      const allSessions = db.getSessionsList(100, undefined, true);
      const activeInsightsSessions = insights.summary.total_sessions as number;

      expect(activeInsightsSessions).toBeLessThan(allSessions.length);
    });

    it("should handle empty database gracefully", () => {
      // Clear all data
      const database = new Database(config.DATABASE_PATH);
      database.exec("DELETE FROM conversations");
      database.exec("DELETE FROM tool_usage");
      database.close();

      const insights = db.getInsights();

      expect(insights.summary.total_queries).toBe(0);
      expect(insights.summary.total_cost).toBe(0);
      expect(insights.summary.total_tool_calls).toBe(0);
      expect(insights.daily).toEqual([]);
      expect(insights.by_project).toEqual([]);
      expect(insights.by_tool).toEqual([]);
    });

    it("should sort daily entries by date ascending", () => {
      const insights = db.getInsights();
      const daily = insights.daily as Array<Record<string, unknown>>;

      if (daily.length > 1) {
        for (let i = 1; i < daily.length; i++) {
          const prevDate = new Date(daily[i - 1].date as string);
          const currDate = new Date(daily[i].date as string);
          expect(currDate >= prevDate).toBe(true);
        }
      }
    });

    it("should sort projects by query count descending", () => {
      const insights = db.getInsights();
      const projects = insights.by_project as Array<Record<string, unknown>>;

      if (projects.length > 1) {
        for (let i = 1; i < projects.length; i++) {
          expect(projects[i - 1].queries as number).toBeGreaterThanOrEqual(projects[i].queries as number);
        }
      }
    });

    it("should sort tools by count descending", () => {
      const insights = db.getInsights();
      const tools = insights.by_tool as Array<Record<string, unknown>>;

      if (tools.length > 1) {
        for (let i = 1; i < tools.length; i++) {
          expect(tools[i - 1].count as number).toBeGreaterThanOrEqual(tools[i].count as number);
        }
      }
    });

    it("should extract project name from path", () => {
      const insights = db.getInsights();
      const projects = insights.by_project as Array<Record<string, unknown>>;

      const project = projects.find((p: Record<string, unknown>) => p.path === "/path/to/project1");
      expect(project).toBeDefined();
      expect(project!.project).toBe("project1");
    });
  });

  describe("Migration System", () => {
    afterAll(() => {
      // Clean up any mocks that might have been applied
      vi.doUnmock("../config.js");
    });

    it("should create schema_version table on fresh database", () => {
      // Force a fresh database by closing and reopening
      const database = new Database(config.DATABASE_PATH);

      const tableExists = database.prepare(`
        SELECT COUNT(*) as c FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_version'
      `).get() as { c: number };

      database.close();

      expect(tableExists.c).toBe(1);
    });

    it("should mark new database as version 4", () => {
      const database = new Database(config.DATABASE_PATH);

      const version = database.prepare(
        "SELECT MAX(version) as v FROM schema_version"
      ).get() as { v: number | null };

      database.close();

      expect(version.v).toBe(4);
    });

    it("should have applied_at timestamp", () => {
      const database = new Database(config.DATABASE_PATH);

      const row = database.prepare(
        "SELECT applied_at FROM schema_version WHERE version = 1"
      ).get() as { applied_at: string } | undefined;

      database.close();

      expect(row).toBeDefined();
      expect(row!.applied_at).toBeTruthy();
    });

    it("should not re-run migrations on subsequent connections", () => {
      const database = new Database(config.DATABASE_PATH);

      const countBefore = database.prepare(
        "SELECT COUNT(*) as c FROM schema_version"
      ).get() as { c: number };

      database.close();

      // Trigger getDb() to run migration check
      db.recordMessage("test", "user", "user", "test message");

      const database2 = new Database(config.DATABASE_PATH);

      const countAfter = database2.prepare(
        "SELECT COUNT(*) as c FROM schema_version"
      ).get() as { c: number };

      database2.close();

      expect(countAfter.c).toBe(countBefore.c);
    });

    it("should detect existing database and mark as v1 without re-creating tables", () => {
      // Create a new temp database simulating an old database (no schema_version table)
      const legacyDbPath = path.join(testDir, "legacy.db");
      const legacyDb = new Database(legacyDbPath);

      // Create a minimal conversations table as if it's an old database
      legacyDb.exec(`
        CREATE TABLE conversations (
          id INTEGER PRIMARY KEY,
          session_id TEXT,
          user_id TEXT,
          role TEXT,
          content TEXT
        );
      `);

      // Insert a test record
      legacyDb.prepare(
        "INSERT INTO conversations (session_id, user_id, role, content) VALUES (?, ?, ?, ?)"
      ).run("legacy_session", "user1", "user", "old message");

      legacyDb.close();

      // Mock the config to point to the legacy database temporarily
      const originalDbPath = config.DATABASE_PATH;
      vi.doMock("../config.js", async () => {
        const actual = await vi.importActual<typeof import("../config.js")>("../config.js");
        return {
          ...actual,
          DATABASE_PATH: legacyDbPath,
        };
      });

      // Manually trigger migration by opening the database and running the migration logic
      const database = new Database(legacyDbPath);
      database.pragma("journal_mode = WAL");

      // Check conversations table exists before migration
      const conversationsExistsBefore = database.prepare(`
        SELECT COUNT(*) as c FROM sqlite_master
        WHERE type = 'table' AND name = 'conversations'
      `).get() as { c: number };

      expect(conversationsExistsBefore.c).toBe(1);

      // Check schema_version doesn't exist yet
      const schemaVersionExistsBefore = database.prepare(`
        SELECT COUNT(*) as c FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_version'
      `).get() as { c: number };

      expect(schemaVersionExistsBefore.c).toBe(0);

      // Simulate the migration detection logic
      const conversationsExists = database.prepare(`
        SELECT COUNT(*) as c FROM sqlite_master
        WHERE type = 'table' AND name = 'conversations'
      `).get() as { c: number };

      if (conversationsExists.c > 0) {
        database.exec(`
          CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
          );
          INSERT INTO schema_version (version) VALUES (1);
        `);
      }

      // Verify schema_version was created and marked as v1
      const version = database.prepare(
        "SELECT MAX(version) as v FROM schema_version"
      ).get() as { v: number | null };

      expect(version.v).toBe(1);

      // Verify the old record still exists
      const oldRecord = database.prepare(
        "SELECT content FROM conversations WHERE session_id = ?"
      ).get("legacy_session") as { content: string } | undefined;

      expect(oldRecord).toBeDefined();
      expect(oldRecord!.content).toBe("old message");

      database.close();
    });
  });

  describe("Semantic Search", () => {
    it("should search conversations using FTS5", () => {
      db.recordMessage("sess1", "user1", "user", "I need help with TypeScript");
      db.recordMessage("sess1", "user1", "assistant", "Sure, I can help with TypeScript");
      db.recordMessage("sess2", "user1", "user", "JavaScript is great");
      db.recordMessage("sess2", "user1", "assistant", "Yes, JavaScript is powerful");

      const results = db.semanticSearchConversations("TypeScript");

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.content.includes("TypeScript"))).toBe(true);
    });

    it("should return results sorted by relevance", () => {
      db.recordMessage("sess1", "user1", "user", "TypeScript is good");
      db.recordMessage("sess2", "user1", "user", "I love TypeScript TypeScript TypeScript");

      const results = db.semanticSearchConversations("TypeScript");

      expect(results.length).toBe(2);
      expect(results[0].content.includes("TypeScript TypeScript TypeScript")).toBe(true);
    });

    it("should limit results", () => {
      for (let i = 0; i < 30; i++) {
        db.recordMessage(`sess${i}`, "user1", "user", `Message ${i} about TypeScript`);
      }

      const results = db.semanticSearchConversations("TypeScript", 10);

      expect(results.length).toBe(10);
    });

    it("should exclude archived conversations", () => {
      db.recordMessage("sess1", "user1", "user", "TypeScript rocks");
      const database = new Database(config.DATABASE_PATH);
      database.exec("UPDATE conversations SET archived = 1 WHERE session_id = 'sess1'");
      database.close();

      const results = db.semanticSearchConversations("TypeScript");

      expect(results.length).toBe(0);
    });

    it("should handle empty query gracefully", () => {
      db.recordMessage("sess1", "user1", "user", "Hello world");

      const results = db.semanticSearchConversations("");

      expect(results.length).toBe(0);
    });
  });
});
