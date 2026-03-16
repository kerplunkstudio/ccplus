import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Create a temp directory for test databases
const testDir = mkdtempSync(path.join(tmpdir(), "ccplus-test-"));
const testDbPath = path.join(testDir, "test.db");

// Mock the config module to use a temp database
vi.mock("../config.js", async () => {
  const actual = await vi.importActual<typeof import("../config.js")>("../config.js");
  return {
    ...actual,
    DATABASE_PATH: testDbPath,
  };
});

// Import database module after mocking config
const db = await import("../database.js");

describe("Database Tests", () => {
  beforeEach(() => {
    // Clean up the database by deleting all records
    const database = new Database(testDbPath);
    try {
      database.exec("DELETE FROM conversations");
      database.exec("DELETE FROM tool_usage");
      database.exec("DELETE FROM images");
      database.exec("DELETE FROM user_stats");
      database.exec("DELETE FROM workspace_state");
      database.exec("DELETE FROM session_context");
    } catch {
      // Tables might not exist yet, that's okay
    }
    database.close();
  });

  afterEach(() => {
    // Clean up after each test
    try {
      const database = new Database(testDbPath);
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
});
