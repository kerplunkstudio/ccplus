import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import * as memoryDistiller from "../memory-distiller.js";

// Mock dependencies
vi.mock("../database.js", () => ({
  getConversationHistory: vi.fn(),
  getToolEvents: vi.fn(),
}));

vi.mock("../memory-client.js", () => ({
  storeMemory: vi.fn(),
}));

vi.mock("../config.js", () => ({
  MEMORY_DISTILL_DEBOUNCE_MS: 5000,
  MEMORY_DISTILL_MIN_MESSAGES: 5,
}));

vi.mock("../logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import * as database from "../database.js";
import * as memoryClient from "../memory-client.js";
import * as config from "../config.js";

describe("Memory Distiller Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the internal timestamp map by calling shouldDistill with a non-existent session
    // This ensures clean state between tests
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("shouldDistill", () => {
    it("should return true for first distillation", () => {
      const result = memoryDistiller.shouldDistill("session-1");
      expect(result).toBe(true);
    });

    it("should return false within debounce window", async () => {
      const sessionId = "session-2-debounce";

      // First call should return true (no previous distillation)
      const first = memoryDistiller.shouldDistill(sessionId);
      expect(first).toBe(true);

      // Mock database to return enough messages for distillation
      const conversations = [
        { id: 1, role: "user", content: "First message" },
        { id: 2, role: "assistant", content: "Response 1" },
        { id: 3, role: "user", content: "Second message" },
        { id: 4, role: "assistant", content: "Response 2" },
        { id: 5, role: "user", content: "Third message" },
        { id: 6, role: "assistant", content: "Response 3" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      // Perform actual distillation (this updates the timestamp)
      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Immediately after distillation, shouldDistill should return false (within debounce window)
      const second = memoryDistiller.shouldDistill(sessionId);
      expect(second).toBe(false);

      // Verify that calling shouldDistill multiple times while debounced still returns false
      const third = memoryDistiller.shouldDistill(sessionId);
      expect(third).toBe(false);
    });

    it("should return true after debounce window expires", async () => {
      vi.useFakeTimers();  // Set up fake timers FIRST
      const sessionId = "session-3";

      // Mock distillSession to update timestamp
      const conversations = [
        { id: 1, role: "user", content: "First message" },
        { id: 2, role: "assistant", content: "Response 1" },
        { id: 3, role: "user", content: "Second message" },
        { id: 4, role: "assistant", content: "Response 2" },
        { id: 5, role: "user", content: "Third message" },
        { id: 6, role: "assistant", content: "Response 3" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Read",
          parameters: { file_path: "/test/file.ts" },
          success: 1,
          error: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      // First distillation
      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Immediately after, should be debounced
      expect(memoryDistiller.shouldDistill(sessionId)).toBe(false);

      // Mock time passage (advance by debounce + 1ms)
      vi.advanceTimersByTime(config.MEMORY_DISTILL_DEBOUNCE_MS + 1);

      // After debounce window, should return true
      expect(memoryDistiller.shouldDistill(sessionId)).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("distillSession", () => {
    it("should skip sessions with fewer than MEMORY_DISTILL_MIN_MESSAGES", async () => {
      const sessionId = "session-4";
      const conversations = [
        { id: 1, role: "user", content: "First message" },
        { id: 2, role: "assistant", content: "Response" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // storeMemory should not be called for sessions below minimum
      expect(memoryClient.storeMemory).not.toHaveBeenCalled();
    });

    it("should extract file paths from tool events correctly", async () => {
      const sessionId = "session-5";
      const conversations = [
        { id: 1, role: "user", content: "Fix the bug" },
        { id: 2, role: "assistant", content: "I'll help" },
        { id: 3, role: "user", content: "Thanks" },
        { id: 4, role: "assistant", content: "Done" },
        { id: 5, role: "user", content: "Great" },
        { id: 6, role: "assistant", content: "Fixed the issue" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Read",
          parameters: { file_path: "/src/server.ts" },
          success: 1,
          error: null,
          agent_type: null,
        },
        {
          id: 2,
          tool_name: "Edit",
          parameters: { file_path: "/src/database.ts", old_string: "old", new_string: "new" },
          success: 1,
          error: null,
          agent_type: null,
        },
        {
          id: 3,
          tool_name: "Write",
          parameters: { file_path: "/src/new-file.ts", content: "export default {}" },
          success: 1,
          error: null,
          agent_type: null,
        },
        {
          id: 4,
          tool_name: "Bash",
          parameters: { command: "npm test" },
          success: 1,
          error: null,
          agent_type: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/myproject");

      // Now stores task-summary + files-modified
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(2);

      // Check files-modified memory
      const filesCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:files-modified')
      );
      expect(filesCall).toBeTruthy();
      if (filesCall) {
        const [content] = filesCall;
        expect(content).toContain("/src/server.ts");
        expect(content).toContain("/src/database.ts");
        expect(content).toContain("/src/new-file.ts");
        expect(content).toContain("Files modified:");
      }
    });

    it("should extract errors from failed tool events", async () => {
      const sessionId = "session-6";
      const conversations = [
        { id: 1, role: "user", content: "Deploy the app" },
        { id: 2, role: "assistant", content: "Deploying..." },
        { id: 3, role: "user", content: "Status?" },
        { id: 4, role: "assistant", content: "Error occurred" },
        { id: 5, role: "user", content: "Fix it" },
        { id: 6, role: "assistant", content: "Fixed" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Bash",
          parameters: { command: "npm run build" },
          success: 0,
          error: "Build failed: TypeScript compilation error at line 42",
          agent_type: null,
        },
        {
          id: 2,
          tool_name: "Bash",
          parameters: { command: "npm test" },
          success: 0,
          error: "Test suite failed: 3 tests failed",
          agent_type: null,
        },
        {
          id: 3,
          tool_name: "Read",
          parameters: { file_path: "/src/app.ts" },
          success: 1,
          error: null,
          agent_type: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/myproject");

      // Now stores task-summary + files-modified + errors-encountered
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(3);

      // Check errors-encountered memory
      const errorsCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:errors-encountered')
      );
      expect(errorsCall).toBeTruthy();
      if (errorsCall) {
        const [content] = errorsCall;
        expect(content).toContain("Errors encountered:");
        expect(content).toContain("Build failed");
        expect(content).toContain("Test suite failed");
      }
    });

    it("should format memory content correctly with all sections", async () => {
      const sessionId = "session-7";
      const conversations = [
        { id: 1, role: "user", content: "Implement user authentication" },
        { id: 2, role: "assistant", content: "Working on it" },
        { id: 3, role: "user", content: "Add tests" },
        { id: 4, role: "assistant", content: "Tests added" },
        { id: 5, role: "user", content: "Deploy" },
        { id: 6, role: "assistant", content: "Successfully deployed authentication system" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Write",
          parameters: { file_path: "/src/auth.ts" },
          success: 1,
          error: null,
          agent_type: "code_agent",
        },
        {
          id: 2,
          tool_name: "Bash",
          parameters: { command: "npm test" },
          success: 1,
          error: null,
          agent_type: null,
        },
        {
          id: 3,
          tool_name: "Task",
          parameters: { instructions: "Deploy auth" },
          success: 1,
          error: null,
          agent_type: "deployment_agent",
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/authproject");

      // Now stores multiple memories (task-summary, files-modified, agents-used)
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(3);

      // Check task summary memory
      const taskSummaryCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:task-summary')
      );
      expect(taskSummaryCall).toBeTruthy();
      if (taskSummaryCall) {
        const [content] = taskSummaryCall;
        expect(content).toContain("Goal: Implement user authentication");
        expect(content).toContain("Outcome: Successfully deployed authentication system");
      }

      // Check files-modified memory
      const filesCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:files-modified')
      );
      expect(filesCall).toBeTruthy();
      if (filesCall) {
        const [content] = filesCall;
        expect(content).toContain("Files modified: /src/auth.ts");
      }

      // Check agents-used memory
      const agentsCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:agents-used')
      );
      expect(agentsCall).toBeTruthy();
      if (agentsCall) {
        const [content] = agentsCall;
        expect(content).toContain("Agents used:");
        expect(content).toContain("code_agent");
        expect(content).toContain("deployment_agent");
      }
    });

    it("should call storeMemory with correct tags including project name", async () => {
      const sessionId = "session-8";
      const conversations = [
        { id: 1, role: "user", content: "Create dashboard" },
        { id: 2, role: "assistant", content: "Working..." },
        { id: 3, role: "user", content: "Add charts" },
        { id: 4, role: "assistant", content: "Charts added" },
        { id: 5, role: "user", content: "Done" },
        { id: 6, role: "assistant", content: "Dashboard complete" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/dashboard-app");

      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);
      const [, tags, metadata] = vi.mocked(memoryClient.storeMemory).mock.calls[0];

      // Verify tags
      expect(tags).toContain("project:dashboard-app");
      expect(tags).toContain("session:session-8");
      expect(tags).toContain("auto-distill");

      // Verify metadata
      expect(metadata).toEqual({
        session_id: sessionId,
        workspace: "/workspace/dashboard-app",
        message_count: "6",
        tool_count: "0",
      });
    });

    it("should add pre-compact tag when preCompaction option is true", async () => {
      const sessionId = "session-9";
      const conversations = [
        { id: 1, role: "user", content: "Fix bug" },
        { id: 2, role: "assistant", content: "Fixed" },
        { id: 3, role: "user", content: "Test" },
        { id: 4, role: "assistant", content: "Tested" },
        { id: 5, role: "user", content: "Deploy" },
        { id: 6, role: "assistant", content: "Deployed" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test", { preCompaction: true });

      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);
      const [, tags] = vi.mocked(memoryClient.storeMemory).mock.calls[0];

      expect(tags).toContain("pre-compact");
    });

    it("should not add pre-compact tag when preCompaction is false", async () => {
      const sessionId = "session-10";
      const conversations = [
        { id: 1, role: "user", content: "Update docs" },
        { id: 2, role: "assistant", content: "Updated" },
        { id: 3, role: "user", content: "Review" },
        { id: 4, role: "assistant", content: "Reviewed" },
        { id: 5, role: "user", content: "Publish" },
        { id: 6, role: "assistant", content: "Published" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/docs", { preCompaction: false });

      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);
      const [, tags] = vi.mocked(memoryClient.storeMemory).mock.calls[0];

      expect(tags).not.toContain("pre-compact");
    });

    it("should never throw (catches errors internally)", async () => {
      const sessionId = "session-11";

      // Mock database to throw error
      vi.mocked(database.getConversationHistory).mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      // Should not throw
      await expect(
        memoryDistiller.distillSession(sessionId, "/workspace/test")
      ).resolves.toBeUndefined();
    });

    it("should handle storeMemory errors gracefully", async () => {
      const sessionId = "session-12";
      const conversations = [
        { id: 1, role: "user", content: "Test message" },
        { id: 2, role: "assistant", content: "Response" },
        { id: 3, role: "user", content: "Another" },
        { id: 4, role: "assistant", content: "Reply" },
        { id: 5, role: "user", content: "More" },
        { id: 6, role: "assistant", content: "Done" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockRejectedValue(new Error("Network error"));

      // Should not throw
      await expect(
        memoryDistiller.distillSession(sessionId, "/workspace/test")
      ).resolves.toBeUndefined();
    });

    it("should truncate long error messages", async () => {
      const sessionId = "session-13";
      const conversations = [
        { id: 1, role: "user", content: "Run tests" },
        { id: 2, role: "assistant", content: "Running..." },
        { id: 3, role: "user", content: "Check" },
        { id: 4, role: "assistant", content: "Checked" },
        { id: 5, role: "user", content: "Fix" },
        { id: 6, role: "assistant", content: "Fixed" },
      ];

      const longError = "A".repeat(300);
      const toolEvents = [
        {
          id: 1,
          tool_name: "Bash",
          parameters: { command: "npm test" },
          success: 0,
          error: longError,
          agent_type: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Now stores task-summary + errors-encountered
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(2);

      // Check errors-encountered memory
      const errorsCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:errors-encountered')
      );
      expect(errorsCall).toBeTruthy();
      if (errorsCall) {
        const [content] = errorsCall;
        // Error should be truncated to 200 chars + "..."
        expect(content).toContain("A".repeat(200) + "...");
        expect(content).not.toContain("A".repeat(300));
      }
    });

    it("should skip distillation when debounce prevents it", async () => {
      const sessionId = "session-14";
      const conversations = [
        { id: 1, role: "user", content: "First" },
        { id: 2, role: "assistant", content: "Response" },
        { id: 3, role: "user", content: "Second" },
        { id: 4, role: "assistant", content: "Reply" },
        { id: 5, role: "user", content: "Third" },
        { id: 6, role: "assistant", content: "Done" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      // First distillation
      await memoryDistiller.distillSession(sessionId, "/workspace/test");
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);

      // Immediate second call should be blocked by debounce
      await memoryDistiller.distillSession(sessionId, "/workspace/test");
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it("should handle missing first user message gracefully", async () => {
      const sessionId = "session-15";
      const conversations = [
        { id: 1, role: "assistant", content: "Hello, how can I help?" },
        { id: 2, role: "assistant", content: "Still waiting..." },
        { id: 3, role: "assistant", content: "Let me know" },
        { id: 4, role: "assistant", content: "Anytime" },
        { id: 5, role: "assistant", content: "Here" },
        { id: 6, role: "assistant", content: "Ready" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);
      const [content] = vi.mocked(memoryClient.storeMemory).mock.calls[0];

      expect(content).toContain("Goal: Unknown goal");
    });

    it("should handle missing last assistant message gracefully", async () => {
      const sessionId = "session-16";
      const conversations = [
        { id: 1, role: "user", content: "Help me" },
        { id: 2, role: "user", content: "Please" },
        { id: 3, role: "user", content: "Now" },
        { id: 4, role: "user", content: "Urgent" },
        { id: 5, role: "user", content: "Really" },
        { id: 6, role: "user", content: "Help" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);
      const [content] = vi.mocked(memoryClient.storeMemory).mock.calls[0];

      expect(content).toContain("Outcome: No outcome");
    });

    it("should deduplicate file paths", async () => {
      const sessionId = "session-17";
      const conversations = [
        { id: 1, role: "user", content: "Fix bugs" },
        { id: 2, role: "assistant", content: "Fixing..." },
        { id: 3, role: "user", content: "Test" },
        { id: 4, role: "assistant", content: "Testing..." },
        { id: 5, role: "user", content: "Deploy" },
        { id: 6, role: "assistant", content: "Deployed" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Read",
          parameters: { file_path: "/src/app.ts" },
          success: 1,
          error: null,
          agent_type: null,
        },
        {
          id: 2,
          tool_name: "Edit",
          parameters: { file_path: "/src/app.ts" },
          success: 1,
          error: null,
          agent_type: null,
        },
        {
          id: 3,
          tool_name: "Read",
          parameters: { file_path: "/src/app.ts" },
          success: 1,
          error: null,
          agent_type: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Now stores task-summary + files-modified
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(2);

      // Check files-modified memory
      const filesCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:files-modified')
      );
      expect(filesCall).toBeTruthy();
      if (filesCall) {
        const [content] = filesCall;
        // File should appear only once despite multiple tool events
        const fileMatches = content.match(/\/src\/app\.ts/g);
        expect(fileMatches).toHaveLength(1);
      }
    });

    it("should deduplicate tool names", async () => {
      const sessionId = "session-18";
      const conversations = [
        { id: 1, role: "user", content: "Build project" },
        { id: 2, role: "assistant", content: "Building..." },
        { id: 3, role: "user", content: "Test" },
        { id: 4, role: "assistant", content: "Testing..." },
        { id: 5, role: "user", content: "Complete" },
        { id: 6, role: "assistant", content: "Done" },
      ];

      const toolEvents = [
        { id: 1, tool_name: "Bash", parameters: {}, success: 1, error: null, agent_type: null },
        { id: 2, tool_name: "Bash", parameters: {}, success: 1, error: null, agent_type: null },
        { id: 3, tool_name: "Read", parameters: {}, success: 1, error: null, agent_type: null },
        { id: 4, tool_name: "Bash", parameters: {}, success: 1, error: null, agent_type: null },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Only task-summary stored (no files, no agents, no errors)
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);

      // Task summary doesn't include tool names anymore (moved to agents-used if applicable)
      const taskSummaryCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:task-summary')
      );
      expect(taskSummaryCall).toBeTruthy();
    });

    it("should exclude tool IDs starting with 'toolu_' from tool names", async () => {
      const sessionId = "session-19";
      const conversations = [
        { id: 1, role: "user", content: "Test" },
        { id: 2, role: "assistant", content: "Testing" },
        { id: 3, role: "user", content: "More" },
        { id: 4, role: "assistant", content: "Done" },
        { id: 5, role: "user", content: "End" },
        { id: 6, role: "assistant", content: "Finished" },
      ];

      const toolEvents = [
        { id: 1, tool_name: "Read", parameters: {}, success: 1, error: null, agent_type: null },
        { id: 2, tool_name: "toolu_abc123", parameters: {}, success: 1, error: null, agent_type: null },
        { id: 3, tool_name: "Bash", parameters: {}, success: 1, error: null, agent_type: null },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Only task-summary stored (no agents involved)
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);

      const taskSummaryCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:task-summary')
      );
      expect(taskSummaryCall).toBeTruthy();

      // Task summary should not include tool names (only agents-used memory has tools)
      // And should not contain toolu_ prefix tool names
      if (taskSummaryCall) {
        const [content] = taskSummaryCall;
        expect(content).not.toContain("toolu_");
      }
    });

    it("should truncate goal and outcome messages", async () => {
      const sessionId = "session-20";
      const longGoal = "A".repeat(250);
      const longOutcome = "B".repeat(600);
      const conversations = [
        { id: 1, role: "user", content: longGoal },
        { id: 2, role: "assistant", content: "Working" },
        { id: 3, role: "user", content: "Continue" },
        { id: 4, role: "assistant", content: "Processing" },
        { id: 5, role: "user", content: "Finish" },
        { id: 6, role: "assistant", content: longOutcome },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(1);
      const [content] = vi.mocked(memoryClient.storeMemory).mock.calls[0];

      // Goal should be truncated to 200 chars
      expect(content).toContain("A".repeat(200) + "...");
      // Outcome should be truncated to 500 chars
      expect(content).toContain("B".repeat(500) + "...");
    });

    it("should trigger cleanup after CLEANUP_INTERVAL_MS", async () => {
      vi.useFakeTimers();

      // Create multiple sessions
      const sessions = ["cleanup-1", "cleanup-2", "cleanup-3"];
      const conversations = [
        { id: 1, role: "user", content: "Test" },
        { id: 2, role: "assistant", content: "Response" },
        { id: 3, role: "user", content: "More" },
        { id: 4, role: "assistant", content: "Reply" },
        { id: 5, role: "user", content: "End" },
        { id: 6, role: "assistant", content: "Done" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      // Process each session
      for (const sessionId of sessions) {
        await memoryDistiller.distillSession(sessionId, "/workspace/test");
      }

      // Advance time by more than 1 hour (cleanup interval)
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000);

      // Trigger cleanup by calling shouldDistill with a new session
      // This should trigger the cleanup logic
      const result = memoryDistiller.shouldDistill("trigger-cleanup");
      expect(result).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("Split memory types", () => {
    it("should create task-summary memory for every session", async () => {
      const sessionId = "session-split-1";
      const conversations = [
        { id: 1, role: "user", content: "Build feature X" },
        { id: 2, role: "assistant", content: "Working..." },
        { id: 3, role: "user", content: "Done?" },
        { id: 4, role: "assistant", content: "Finished" },
        { id: 5, role: "user", content: "Great" },
        { id: 6, role: "assistant", content: "Feature X complete" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      const taskSummaryCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:task-summary')
      );

      expect(taskSummaryCall).toBeTruthy();
      if (taskSummaryCall) {
        const [content, tags] = taskSummaryCall;
        expect(content).toContain("Goal: Build feature X");
        expect(content).toContain("Outcome: Feature X complete");
        expect(tags).toContain("type:task-summary");
      }
    });

    it("should only create files-modified memory when files are touched", async () => {
      const sessionId = "session-split-2";
      const conversations = [
        { id: 1, role: "user", content: "Check status" },
        { id: 2, role: "assistant", content: "Status OK" },
        { id: 3, role: "user", content: "Good" },
        { id: 4, role: "assistant", content: "Done" },
        { id: 5, role: "user", content: "Thanks" },
        { id: 6, role: "assistant", content: "Welcome" },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue([]); // No file tools
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Should only have task-summary, no files-modified
      const filesCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:files-modified')
      );
      expect(filesCall).toBeUndefined();
    });

    it("should create files-modified memory when files are touched", async () => {
      const sessionId = "session-split-3";
      const conversations = [
        { id: 1, role: "user", content: "Update code" },
        { id: 2, role: "assistant", content: "Updating..." },
        { id: 3, role: "user", content: "Test" },
        { id: 4, role: "assistant", content: "Testing..." },
        { id: 5, role: "user", content: "Done" },
        { id: 6, role: "assistant", content: "Complete" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Edit",
          parameters: { file_path: "/src/app.ts", old_string: "old", new_string: "new" },
          success: 1,
          error: null,
          agent_type: null,
        },
        {
          id: 2,
          tool_name: "Write",
          parameters: { file_path: "/src/utils.ts", content: "export {}" },
          success: 1,
          error: null,
          agent_type: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      const filesCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:files-modified')
      );

      expect(filesCall).toBeTruthy();
      if (filesCall) {
        const [content, tags] = filesCall;
        expect(content).toContain("Files modified:");
        expect(content).toContain("/src/app.ts");
        expect(content).toContain("/src/utils.ts");
        expect(tags).toContain("type:files-modified");
      }
    });

    it("should only create errors-encountered memory when errors exist", async () => {
      const sessionId = "session-split-4";
      const conversations = [
        { id: 1, role: "user", content: "Run build" },
        { id: 2, role: "assistant", content: "Building..." },
        { id: 3, role: "user", content: "Status" },
        { id: 4, role: "assistant", content: "Success" },
        { id: 5, role: "user", content: "Good" },
        { id: 6, role: "assistant", content: "Done" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Bash",
          parameters: { command: "npm run build" },
          success: 1, // Success
          error: null,
          agent_type: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Should not have errors-encountered memory
      const errorsCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:errors-encountered')
      );
      expect(errorsCall).toBeUndefined();
    });

    it("should create errors-encountered memory when errors exist", async () => {
      const sessionId = "session-split-5";
      const conversations = [
        { id: 1, role: "user", content: "Deploy" },
        { id: 2, role: "assistant", content: "Deploying..." },
        { id: 3, role: "user", content: "Fix" },
        { id: 4, role: "assistant", content: "Fixed" },
        { id: 5, role: "user", content: "Retry" },
        { id: 6, role: "assistant", content: "Success" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Bash",
          parameters: { command: "npm run deploy" },
          success: 0,
          error: "Deployment failed: connection timeout",
          agent_type: null,
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      const errorsCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:errors-encountered')
      );

      expect(errorsCall).toBeTruthy();
      if (errorsCall) {
        const [content, tags] = errorsCall;
        expect(content).toContain("Errors encountered:");
        expect(content).toContain("Deployment failed");
        expect(tags).toContain("type:errors-encountered");
      }
    });

    it("should only create agents-used memory when agents are involved", async () => {
      const sessionId = "session-split-6";
      const conversations = [
        { id: 1, role: "user", content: "Check files" },
        { id: 2, role: "assistant", content: "Checking..." },
        { id: 3, role: "user", content: "OK" },
        { id: 4, role: "assistant", content: "Done" },
        { id: 5, role: "user", content: "Thanks" },
        { id: 6, role: "assistant", content: "Welcome" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Read",
          parameters: { file_path: "/src/app.ts" },
          success: 1,
          error: null,
          agent_type: null, // No agent
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      // Should not have agents-used memory
      const agentsCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:agents-used')
      );
      expect(agentsCall).toBeUndefined();
    });

    it("should create agents-used memory when agents are involved", async () => {
      const sessionId = "session-split-7";
      const conversations = [
        { id: 1, role: "user", content: "Review code" },
        { id: 2, role: "assistant", content: "Reviewing..." },
        { id: 3, role: "user", content: "Deploy" },
        { id: 4, role: "assistant", content: "Deploying..." },
        { id: 5, role: "user", content: "Done" },
        { id: 6, role: "assistant", content: "Complete" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Agent",
          parameters: { description: "Review code quality" },
          success: 1,
          error: null,
          agent_type: "code-reviewer",
        },
        {
          id: 2,
          tool_name: "Agent",
          parameters: { description: "Deploy app" },
          success: 1,
          error: null,
          agent_type: "deployment_agent",
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/test");

      const agentsCall = vi.mocked(memoryClient.storeMemory).mock.calls.find(
        call => call[1].includes('type:agents-used')
      );

      expect(agentsCall).toBeTruthy();
      if (agentsCall) {
        const [content, tags] = agentsCall;
        expect(content).toContain("Agents used:");
        expect(content).toContain("code-reviewer");
        expect(content).toContain("deployment_agent");
        expect(tags).toContain("type:agents-used");
      }
    });

    it("should create all 4 memory types when applicable", async () => {
      const sessionId = "session-split-8";
      const conversations = [
        { id: 1, role: "user", content: "Implement auth" },
        { id: 2, role: "assistant", content: "Working..." },
        { id: 3, role: "user", content: "Test" },
        { id: 4, role: "assistant", content: "Testing..." },
        { id: 5, role: "user", content: "Deploy" },
        { id: 6, role: "assistant", content: "Auth deployed successfully" },
      ];

      const toolEvents = [
        {
          id: 1,
          tool_name: "Write",
          parameters: { file_path: "/src/auth.ts", content: "export {}" },
          success: 1,
          error: null,
          agent_type: "code_agent",
        },
        {
          id: 2,
          tool_name: "Bash",
          parameters: { command: "npm test" },
          success: 0,
          error: "Test failed: auth validation",
          agent_type: null,
        },
        {
          id: 3,
          tool_name: "Agent",
          parameters: { description: "Fix tests" },
          success: 1,
          error: null,
          agent_type: "tdd-guide",
        },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);
      vi.mocked(memoryClient.storeMemory).mockResolvedValue(null);

      await memoryDistiller.distillSession(sessionId, "/workspace/authapp");

      // Should have all 4 types
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(4);

      const calls = vi.mocked(memoryClient.storeMemory).mock.calls;
      const tagsSets = calls.map(c => c[1]);

      expect(tagsSets.some(t => t.includes('type:task-summary'))).toBe(true);
      expect(tagsSets.some(t => t.includes('type:files-modified'))).toBe(true);
      expect(tagsSets.some(t => t.includes('type:errors-encountered'))).toBe(true);
      expect(tagsSets.some(t => t.includes('type:agents-used'))).toBe(true);
    });

    it("should store remaining memories even if one fails (Promise.allSettled)", async () => {
      const sessionId = "session-partial-fail";
      const conversations = [
        { id: 1, role: "user", content: "Do work" },
        { id: 2, role: "assistant", content: "Working" },
        { id: 3, role: "user", content: "More" },
        { id: 4, role: "assistant", content: "Done" },
        { id: 5, role: "user", content: "Finish" },
        { id: 6, role: "assistant", content: "Complete" },
      ];
      const toolEvents = [
        { id: 1, tool_name: "Write", parameters: { file_path: "/src/b.ts" }, success: 1, error: null, agent_type: null },
      ];

      vi.mocked(database.getConversationHistory).mockReturnValue(conversations);
      vi.mocked(database.getToolEvents).mockReturnValue(toolEvents);

      // First call fails, second succeeds
      vi.mocked(memoryClient.storeMemory)
        .mockRejectedValueOnce(new Error("Network failure"))
        .mockResolvedValue(null);

      // Should not throw
      await expect(
        memoryDistiller.distillSession(sessionId, "/workspace/test")
      ).resolves.toBeUndefined();

      // Both stores were attempted
      expect(memoryClient.storeMemory).toHaveBeenCalledTimes(2);
    });
  });
});
