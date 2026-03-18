import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Create a temp directory for test databases
const testDir = mkdtempSync(path.join(tmpdir(), "ccplus-test-transcript-"));
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

describe("Transcript Events Tests", () => {
  beforeEach(() => {
    // Clean up the database by deleting all records
    const database = new Database(testDbPath);
    try {
      database.exec("DELETE FROM transcript_events");
      database.exec("DELETE FROM conversations");
      database.exec("DELETE FROM tool_usage");
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

  describe("recordTranscriptEvent", () => {
    it("should record a user_message event", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: {
          content: "Hello world",
          role: "user",
        },
      });

      expect(event.session_id).toBe("sess1");
      expect(event.event_type).toBe("user_message");
      expect(event.data.content).toBe("Hello world");
      expect(event.data.role).toBe("user");
      expect(event.event_id).toBeDefined();
      expect(event.parent_event_id).toBeNull();
      expect(event.timestamp).toBeDefined();
      expect(event.metadata).toBeNull();
    });

    it("should record an assistant_message event with metadata", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "assistant_message",
        data: {
          content: "Response text",
          role: "assistant",
        },
        metadata: {
          cost: 0.05,
          input_tokens: 100,
          output_tokens: 50,
          model: "sonnet",
        },
      });

      expect(event.event_type).toBe("assistant_message");
      expect(event.metadata).toBeDefined();
      expect(event.metadata?.cost).toBe(0.05);
      expect(event.metadata?.model).toBe("sonnet");
    });

    it("should record a tool_start event with custom event_id", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        event_id: "tool_123",
        data: {
          tool_name: "Bash",
          parameters: { command: "ls -la" },
        },
      });

      expect(event.event_id).toBe("tool_123");
      expect(event.event_type).toBe("tool_start");
      expect(event.data.tool_name).toBe("Bash");
    });

    it("should record a tool_complete event with parent", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_complete",
        event_id: "tool_123",
        parent_event_id: "agent_456",
        data: {
          tool_name: "Bash",
          success: true,
          duration_ms: 1234,
        },
      });

      expect(event.parent_event_id).toBe("agent_456");
      expect(event.data.success).toBe(true);
      expect(event.data.duration_ms).toBe(1234);
    });

    it("should record an agent_start event", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "agent_start",
        event_id: "agent_789",
        data: {
          agent_type: "code_agent",
          description: "Fix the bug in auth.ts",
        },
      });

      expect(event.event_type).toBe("agent_start");
      expect(event.data.agent_type).toBe("code_agent");
      expect(event.data.description).toBe("Fix the bug in auth.ts");
    });

    it("should record an agent_stop event", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "agent_stop",
        event_id: "agent_789",
        data: {
          agent_type: "code_agent",
          success: true,
          duration_ms: 45000,
        },
      });

      expect(event.event_type).toBe("agent_stop");
      expect(event.data.success).toBe(true);
      expect(event.data.duration_ms).toBe(45000);
    });

    it("should record an error event", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "error",
        data: {
          message: "Connection timeout",
        },
      });

      expect(event.event_type).toBe("error");
      expect(event.data.message).toBe("Connection timeout");
    });

    it("should record a cancel event", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "cancel",
        data: {
          cancelled_by: "user123",
        },
      });

      expect(event.event_type).toBe("cancel");
      expect(event.data.cancelled_by).toBe("user123");
    });

    it("should auto-generate event_id if not provided", () => {
      const event1 = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: "test" },
      });

      const event2 = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: "test2" },
      });

      expect(event1.event_id).toBeDefined();
      expect(event2.event_id).toBeDefined();
      expect(event1.event_id).not.toBe(event2.event_id);
    });

    it("should handle complex nested data structures", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        data: {
          tool_name: "Edit",
          parameters: {
            file_path: "/path/to/file.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
            nested: {
              deep: {
                value: 123,
              },
            },
          },
        },
      });

      expect(event.data.parameters).toBeDefined();
      const params = event.data.parameters as Record<string, unknown>;
      expect(params.file_path).toBe("/path/to/file.ts");
      const nested = params.nested as Record<string, unknown>;
      const deep = nested.deep as Record<string, unknown>;
      expect(deep.value).toBe(123);
    });
  });

  describe("getTranscript", () => {
    beforeEach(() => {
      // Create some events
      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        event_id: "msg1",
        data: { content: "First message" },
      });

      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        event_id: "tool1",
        data: { tool_name: "Bash" },
      });

      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_complete",
        event_id: "tool1",
        data: { tool_name: "Bash", success: true },
      });

      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "assistant_message",
        event_id: "msg2",
        data: { content: "Response" },
      });

      db.recordTranscriptEvent({
        session_id: "sess2",
        event_type: "user_message",
        event_id: "msg3",
        data: { content: "Different session" },
      });
    });

    it("should return all events for a session", () => {
      const events = db.getTranscript("sess1");

      expect(events).toHaveLength(4);
      expect(events[0].event_id).toBe("msg1");
      expect(events[1].event_id).toBe("tool1");
      expect(events[3].event_id).toBe("msg2");
    });

    it("should return empty array for nonexistent session", () => {
      const events = db.getTranscript("nonexistent");

      expect(events).toEqual([]);
    });

    it("should filter by event types", () => {
      const events = db.getTranscript("sess1", {
        eventTypes: ["user_message", "assistant_message"],
      });

      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("user_message");
      expect(events[1].event_type).toBe("assistant_message");
    });

    it("should filter by multiple event types", () => {
      const events = db.getTranscript("sess1", {
        eventTypes: ["tool_start", "tool_complete"],
      });

      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("tool_start");
      expect(events[1].event_type).toBe("tool_complete");
    });

    it("should respect limit parameter", () => {
      const events = db.getTranscript("sess1", { limit: 2 });

      expect(events).toHaveLength(2);
      expect(events[0].event_id).toBe("msg1");
      expect(events[1].event_id).toBe("tool1");
    });

    it("should respect offset parameter", () => {
      const events = db.getTranscript("sess1", { offset: 2 });

      expect(events).toHaveLength(2);
      expect(events[0].event_id).toBe("tool1");
      expect(events[1].event_id).toBe("msg2");
    });

    it("should respect both limit and offset", () => {
      const events = db.getTranscript("sess1", { limit: 1, offset: 1 });

      expect(events).toHaveLength(1);
      expect(events[0].event_id).toBe("tool1");
    });

    it("should order events by timestamp", () => {
      const events = db.getTranscript("sess1");

      for (let i = 1; i < events.length; i++) {
        expect(new Date(events[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(events[i - 1].timestamp).getTime(),
        );
      }
    });

    it("should preserve data structure on retrieval", () => {
      db.recordTranscriptEvent({
        session_id: "sess3",
        event_type: "tool_start",
        data: {
          tool_name: "Edit",
          parameters: {
            nested: { value: 42 },
          },
        },
      });

      const events = db.getTranscript("sess3");

      expect(events).toHaveLength(1);
      const params = events[0].data.parameters as Record<string, unknown>;
      const nested = params.nested as Record<string, unknown>;
      expect(nested.value).toBe(42);
    });

    it("should preserve metadata structure on retrieval", () => {
      db.recordTranscriptEvent({
        session_id: "sess3",
        event_type: "assistant_message",
        data: { content: "test" },
        metadata: {
          cost: 0.1,
          tokens: { input: 100, output: 50 },
        },
      });

      const events = db.getTranscript("sess3");

      expect(events).toHaveLength(1);
      expect(events[0].metadata?.cost).toBe(0.1);
      const tokens = events[0].metadata?.tokens as Record<string, unknown>;
      expect(tokens.input).toBe(100);
    });
  });

  describe("getTranscriptEvent", () => {
    it("should retrieve a single event by event_id", () => {
      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        event_id: "evt123",
        data: { content: "Find me" },
      });

      const event = db.getTranscriptEvent("evt123");

      expect(event).not.toBeNull();
      expect(event?.event_id).toBe("evt123");
      expect(event?.data.content).toBe("Find me");
    });

    it("should return null for nonexistent event_id", () => {
      const event = db.getTranscriptEvent("nonexistent");

      expect(event).toBeNull();
    });

    it("should return the correct event when multiple exist", () => {
      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        event_id: "evt1",
        data: { content: "First" },
      });

      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        event_id: "evt2",
        data: { content: "Second" },
      });

      const event = db.getTranscriptEvent("evt2");

      expect(event?.event_id).toBe("evt2");
      expect(event?.data.content).toBe("Second");
    });
  });

  describe("exportTranscript", () => {
    beforeEach(() => {
      // Create events across multiple sessions
      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: "Msg 1" },
      });

      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "assistant_message",
        data: { content: "Response 1" },
      });

      db.recordTranscriptEvent({
        session_id: "sess2",
        event_type: "user_message",
        data: { content: "Different session" },
      });
    });

    it("should export all events for a session", () => {
      const events = db.exportTranscript("sess1");

      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("user_message");
      expect(events[1].event_type).toBe("assistant_message");
    });

    it("should return empty array for nonexistent session", () => {
      const events = db.exportTranscript("nonexistent");

      expect(events).toEqual([]);
    });

    it("should order events chronologically", () => {
      const events = db.exportTranscript("sess1");

      for (let i = 1; i < events.length; i++) {
        expect(new Date(events[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(events[i - 1].timestamp).getTime(),
        );
      }
    });

    it("should not include events from other sessions", () => {
      const events = db.exportTranscript("sess1");

      for (const event of events) {
        expect(event.session_id).toBe("sess1");
      }
    });

    it("should export complete event data including metadata", () => {
      db.recordTranscriptEvent({
        session_id: "sess3",
        event_type: "assistant_message",
        data: { content: "test" },
        metadata: { cost: 0.05 },
      });

      const events = db.exportTranscript("sess3");

      expect(events).toHaveLength(1);
      expect(events[0].metadata?.cost).toBe(0.05);
    });
  });

  describe("parent-child relationships", () => {
    it("should maintain parent-child hierarchy", () => {
      const agent = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "agent_start",
        event_id: "agent1",
        data: { agent_type: "code_agent" },
      });

      const tool = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        event_id: "tool1",
        parent_event_id: agent.event_id,
        data: { tool_name: "Bash" },
      });

      expect(tool.parent_event_id).toBe(agent.event_id);
    });

    it("should handle multi-level nesting", () => {
      const rootAgent = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "agent_start",
        event_id: "root",
        data: { agent_type: "orchestrator" },
      });

      const childAgent = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "agent_start",
        event_id: "child",
        parent_event_id: rootAgent.event_id,
        data: { agent_type: "code_agent" },
      });

      const tool = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        event_id: "tool",
        parent_event_id: childAgent.event_id,
        data: { tool_name: "Edit" },
      });

      expect(childAgent.parent_event_id).toBe(rootAgent.event_id);
      expect(tool.parent_event_id).toBe(childAgent.event_id);
    });

    it("should allow null parent for root-level events", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        event_id: "root_tool",
        data: { tool_name: "Bash" },
      });

      expect(event.parent_event_id).toBeNull();
    });
  });

  describe("JSON serialization", () => {
    it("should correctly serialize and deserialize complex data", () => {
      const complexData = {
        tool_name: "Edit",
        parameters: {
          file_path: "/test.ts",
          changes: [
            { line: 10, content: "new code" },
            { line: 20, content: "more code" },
          ],
          metadata: {
            author: "claude",
            timestamp: "2025-01-15",
          },
        },
      };

      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        data: complexData,
      });

      expect(event.data).toEqual(complexData);
    });

    it("should handle null and undefined values in data", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_complete",
        data: {
          tool_name: "Bash",
          success: true,
          error: null,
          optional_field: undefined,
        },
      });

      expect(event.data.error).toBeNull();
      expect(event.data.optional_field).toBeUndefined();
    });

    it("should handle arrays in data", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: {
          content: "test",
          image_ids: ["img1", "img2", "img3"],
        },
      });

      expect(Array.isArray(event.data.image_ids)).toBe(true);
      expect((event.data.image_ids as string[]).length).toBe(3);
    });

    it("should handle empty objects in metadata", () => {
      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: "test" },
        metadata: {},
      });

      expect(event.metadata).toEqual({});
    });
  });

  describe("integration with existing tables", () => {
    it("should coexist with conversations table", () => {
      // Record both conversation and transcript event
      db.recordMessage("sess1", "user1", "user", "Hello");

      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: "Hello" },
      });

      const history = db.getConversationHistory("sess1");
      const transcript = db.getTranscript("sess1");

      expect(history).toHaveLength(1);
      expect(transcript).toHaveLength(1);
    });

    it("should coexist with tool_usage table", () => {
      // Record both tool usage and transcript event
      db.recordToolEvent("sess1", "Bash", "tool1", undefined, undefined, true, null, 100);

      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_complete",
        event_id: "tool1",
        data: { tool_name: "Bash", success: true },
      });

      const toolEvents = db.getToolEvents("sess1");
      const transcript = db.getTranscript("sess1");

      expect(toolEvents).toHaveLength(1);
      expect(transcript).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("should handle very long content in data", () => {
      const longContent = "x".repeat(10000);

      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: longContent },
      });

      expect(event.data.content).toBe(longContent);
    });

    it("should handle special characters in data", () => {
      const specialContent = 'Test "quotes" and \'apostrophes\' and \n newlines \t tabs';

      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: specialContent },
      });

      expect(event.data.content).toBe(specialContent);
    });

    it("should handle unicode characters", () => {
      const unicodeContent = "Hello 世界 🌍 émojis";

      const event = db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "user_message",
        data: { content: unicodeContent },
      });

      expect(event.data.content).toBe(unicodeContent);
    });

    it("should handle multiple events with same event_id in different sessions", () => {
      db.recordTranscriptEvent({
        session_id: "sess1",
        event_type: "tool_start",
        event_id: "shared_id",
        data: { tool_name: "Bash" },
      });

      db.recordTranscriptEvent({
        session_id: "sess2",
        event_type: "tool_start",
        event_id: "shared_id",
        data: { tool_name: "Edit" },
      });

      const events1 = db.getTranscript("sess1");
      const events2 = db.getTranscript("sess2");

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].data.tool_name).toBe("Bash");
      expect(events2[0].data.tool_name).toBe("Edit");
    });
  });
});
