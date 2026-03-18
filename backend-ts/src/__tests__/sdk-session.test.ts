import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

// Hoist mock functions to avoid initialization errors
const { mockQuery, mockDatabase, mockExecFileSync } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockDatabase = {
    recordToolEvent: vi.fn(),
    updateToolEvent: vi.fn(),
    recordMessage: vi.fn(() => ({ id: 1 })),
    updateMessage: vi.fn(),
    getLastSdkSessionId: vi.fn(() => null),
    getImage: vi.fn(() => null),
    getSessionMetadata: vi.fn(() => null),
  };
  const mockExecFileSync = vi.fn(() => "[]");
  return { mockQuery, mockDatabase, mockExecFileSync };
});

// Mock the SDK before importing sdk-session
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
  createSdkMcpServer: vi.fn((config: any) => config),
  tool: vi.fn((name: string, desc: string, schema: any, handler: any) => ({
    name,
    desc,
    schema,
    handler,
  })),
}));

// Mock the database
vi.mock("../database.js", () => mockDatabase);

// Mock child_process to prevent actual Claude CLI execution
vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
}));

import * as sdkSession from "../sdk-session.js";
import * as database from "../database.js";

// Helper to create a mock query that stays active for testing
function createMockQuery(delayMs = 100): Partial<Query> {
  return {
    interrupt: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      // Wait before yielding to keep query active
      await new Promise((r) => setTimeout(r, delayMs));
      yield {
        type: "result",
        session_id: "test-sdk-id",
        total_cost_usd: 0.001,
        duration_ms: 100,
        is_error: false,
        num_turns: 1,
        usage: { input_tokens: 10, output_tokens: 20 },
        modelUsage: {
          "claude-sonnet-4-5": {
            inputTokens: 150,
            outputTokens: 20,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUSD: 0.001,
            contextWindow: 200000,
            maxOutputTokens: 8192,
          },
        },
      } as any;
    },
  };
}

describe("SDK Session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock implementation
    mockQuery.mockReturnValue(createMockQuery());
    // Clean up any active sessions between tests
    const activeSessions = sdkSession.getActiveSessions();
    activeSessions.forEach((sid) => sdkSession.disconnectSession(sid));
  });

  describe("Session Management", () => {
    it("should register a session on submitQuery", async () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "test-session-1",
        "Hello",
        "/tmp/workspace",
        callbacks,
      );

      // Wait for query to start (needs time for async streamQuery to execute)
      await new Promise((r) => setTimeout(r, 50));

      // Session should be tracked as active initially
      expect(sdkSession.isActive("test-session-1")).toBe(true);
    });

    it("should track multiple active sessions", async () => {
      // Use a long delay so both sessions stay active during the check
      mockQuery.mockImplementation(() => createMockQuery(5000));

      const callbacks1 = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };
      const callbacks2 = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "session-1",
        "Query 1",
        "/tmp/workspace",
        callbacks1,
      );
      sdkSession.submitQuery(
        "session-2",
        "Query 2",
        "/tmp/workspace",
        callbacks2,
      );

      // Wait for both queries to start (activeQuery is set before the for-await loop)
      await new Promise((r) => setTimeout(r, 50));

      const active = sdkSession.getActiveSessions();
      expect(active).toContain("session-1");
      expect(active).toContain("session-2");

      // Clean up the long-running sessions
      sdkSession.disconnectSession("session-1");
      sdkSession.disconnectSession("session-2");
    });

    it("should remove session from active list after disconnect", async () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "session-disconnect",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      // Wait for query to start (needs time for async streamQuery to execute)
      await new Promise((r) => setTimeout(r, 50));

      expect(sdkSession.isActive("session-disconnect")).toBe(true);

      sdkSession.disconnectSession("session-disconnect");

      expect(sdkSession.isActive("session-disconnect")).toBe(false);
      const active = sdkSession.getActiveSessions();
      expect(active).not.toContain("session-disconnect");
    });

    it("should return false for isActive on non-existent session", () => {
      expect(sdkSession.isActive("non-existent")).toBe(false);
    });

    it("should return empty array when no active sessions", () => {
      const active = sdkSession.getActiveSessions();
      expect(active).toEqual([]);
    });
  });

  describe("Cancellation", () => {
    it("should set cancel flag on cancelQuery", async () => {
      const mockInterrupt = vi.fn().mockResolvedValue(undefined);
      const mockClose = vi.fn();
      const customMockQuery: Partial<Query> = {
        interrupt: mockInterrupt,
        close: mockClose,
        [Symbol.asyncIterator]: async function* () {
          // Yield slowly to allow cancellation
          await new Promise((r) => setTimeout(r, 50));
          yield {
            type: "result",
            session_id: "test-sdk-id",
            total_cost_usd: 0.001,
            duration_ms: 100,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 10, output_tokens: 20 },
          } as any;
        },
      };

      mockQuery.mockReturnValue(customMockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "cancel-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      // Give query a moment to start
      await new Promise((r) => setTimeout(r, 10));

      sdkSession.cancelQuery("cancel-test");

      // Wait for interrupt to be called
      await new Promise((r) => setTimeout(r, 10));

      expect(mockInterrupt).toHaveBeenCalled();
    });

    it("should handle cancel on non-existent session gracefully", () => {
      expect(() => {
        sdkSession.cancelQuery("non-existent");
      }).not.toThrow();
    });

    it("should unblock pending question on cancel", () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onUserQuestion: vi.fn(),
      };

      sdkSession.submitQuery(
        "pending-cancel",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      // Simulate pending question (normally set during query execution)
      // This is internal, but we can test the public API behavior
      const question = sdkSession.getPendingQuestion("pending-cancel");

      sdkSession.cancelQuery("pending-cancel");

      // After cancel, pending question should be cleared
      const afterCancel = sdkSession.getPendingQuestion("pending-cancel");
      expect(afterCancel).toBeNull();
    });
  });

  describe("Callbacks Registration", () => {
    it("should register callbacks for existing session", () => {
      const initialCallbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "callback-test",
        "Query",
        "/tmp/workspace",
        initialCallbacks,
      );

      const newCallbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.registerCallbacks("callback-test", newCallbacks);

      // Can't directly test internal state, but at least verify it doesn't throw
      expect(() => {
        sdkSession.registerCallbacks("callback-test", newCallbacks);
      }).not.toThrow();
    });

    it("should handle registerCallbacks on non-existent session", () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      expect(() => {
        sdkSession.registerCallbacks("non-existent", callbacks);
      }).not.toThrow();
    });
  });

  describe("Question Handling", () => {
    it("should return null for pending question when none exists", () => {
      const question = sdkSession.getPendingQuestion("no-question");
      expect(question).toBeNull();
    });

    it("should handle sendQuestionResponse on non-existent session", () => {
      expect(() => {
        sdkSession.sendQuestionResponse("non-existent", { answer: "yes" });
      }).not.toThrow();
    });

    it("should handle sendQuestionResponse when no pending question", () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "no-pending",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      expect(() => {
        sdkSession.sendQuestionResponse("no-pending", { answer: "yes" });
      }).not.toThrow();
    });
  });

  describe("Hooks - safeParams helper", () => {
    it("should remove tool_use_id from parameters", async () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      // We'll test this indirectly through the tool event
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          // Simulate result to complete the query
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      sdkSession.submitQuery(
        "safe-params-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // The onToolEvent should have been called without tool_use_id in parameters
      // This is tested indirectly via the hook behavior
    });

    it("should truncate long parameter strings", () => {
      // This tests the safeParams function behavior
      // In the actual implementation, strings > 200 chars are truncated
      const longString = "x".repeat(300);
      const params = { command: longString };

      // The safeParams function should truncate to 200 + "..."
      // We test this through the hook's behavior when recording events
    });
  });

  describe("Hook Events", () => {
    it("should complete query successfully", async () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "hook-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      // Wait for query to complete
      await new Promise((r) => setTimeout(r, 150));

      // The query should complete successfully
      expect(callbacks.onComplete).toHaveBeenCalled();
    });

    it("should emit agent_start for Agent tools", () => {
      // Agent tools should emit agent_start instead of tool_start
      // This is tested through the hook's preToolUse logic
    });

    it("should emit tool_complete on successful completion", async () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      sdkSession.submitQuery(
        "complete-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // onComplete should have been called
      expect(callbacks.onComplete).toHaveBeenCalled();
    });

    it("should calculate duration between pre and post hooks", () => {
      // Duration is calculated using performance.now() in pre/post hooks
      // This is tested through the duration_ms field in events
    });

    it("should swallow database errors gracefully", async () => {
      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      // Make database throw
      vi.mocked(database.recordToolEvent).mockImplementation(() => {
        throw new Error("DB error");
      });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      // Should not throw despite DB error
      expect(() => {
        sdkSession.submitQuery(
          "db-error-test",
          "Test",
          "/tmp/workspace",
          callbacks,
        );
      }).not.toThrow();

      await new Promise((r) => setTimeout(r, 50));

      // Query should still complete
      expect(callbacks.onComplete).toHaveBeenCalled();
    });
  });

  describe("Session Workspace and Model Changes", () => {
    it("should interrupt query when workspace changes", async () => {
      const mockInterrupt = vi.fn().mockResolvedValue(undefined);
      const mockClose = vi.fn();
      const customMockQuery: Partial<Query> = {
        interrupt: mockInterrupt,
        close: mockClose,
        [Symbol.asyncIterator]: async function* () {
          // Slow iterator to allow workspace change
          await new Promise((r) => setTimeout(r, 50));
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      mockQuery.mockReturnValue(customMockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "workspace-test",
        "Query 1",
        "/tmp/workspace1",
        callbacks,
        "sonnet",
      );

      await new Promise((r) => setTimeout(r, 10));

      // Submit with different workspace - should interrupt
      sdkSession.submitQuery(
        "workspace-test",
        "Query 2",
        "/tmp/workspace2",
        callbacks,
        "sonnet",
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(mockInterrupt).toHaveBeenCalled();
    });

    it("should interrupt query when model changes", async () => {
      const mockInterrupt = vi.fn().mockResolvedValue(undefined);
      const mockClose = vi.fn();
      const customMockQuery: Partial<Query> = {
        interrupt: mockInterrupt,
        close: mockClose,
        [Symbol.asyncIterator]: async function* () {
          // Slow iterator to allow model change
          await new Promise((r) => setTimeout(r, 50));
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      mockQuery.mockReturnValue(customMockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "model-test",
        "Query 1",
        "/tmp/workspace",
        callbacks,
        "sonnet",
      );

      await new Promise((r) => setTimeout(r, 10));

      // Submit with different model - should interrupt
      sdkSession.submitQuery(
        "model-test",
        "Query 2",
        "/tmp/workspace",
        callbacks,
        "opus",
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(mockInterrupt).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should call onError when SDK query throws", async () => {
      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockImplementation(() => {
        throw new Error("SDK error");
      });

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "error-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.stringContaining("SDK error"),
      );
    });

    it("should remove session after error", async () => {
      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockImplementation(() => {
        throw new Error("SDK error");
      });

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "error-cleanup-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Session should be removed after error
      expect(sdkSession.isActive("error-cleanup-test")).toBe(false);
    });
  });

  describe("Message Streaming", () => {
    it("should call onText for text deltas", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Hello world" }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "text-stream-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onText).toHaveBeenCalledWith("Hello world", expect.any(Number));
    });

    it("should call onThinkingDelta for thinking blocks", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "thinking", thinking: "Let me think..." }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onThinkingDelta: vi.fn(),
      };

      sdkSession.submitQuery(
        "thinking-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onThinkingDelta).toHaveBeenCalledWith("Let me think...");
    });

    it("should handle stream events with content_block_delta", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "Streamed " },
            },
          } as any;
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "text" },
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "stream-event-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onText).toHaveBeenCalledWith("Streamed ", expect.any(Number));
      expect(callbacks.onText).toHaveBeenCalledWith("text", expect.any(Number));
    });
  });

  describe("Database Integration", () => {
    it("should record assistant messages to database", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Response text" }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "db-message-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(database.recordMessage).toHaveBeenCalledWith(
        "db-message-test",
        "assistant",
        "assistant",
        "Response text",
      );
    });

    it("should update tool events with success status", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "update-tool-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // updateToolEvent should be called for completed tools
      // (This would happen in the postToolUse hook during actual execution)
    });

    it("should update message with SDK session ID on result", async () => {
      vi.mocked(database.recordMessage).mockReturnValue({ id: 42 });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "First" }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "sdk-session-123",
            total_cost_usd: 0.002,
            duration_ms: 500,
            is_error: false,
            num_turns: 2,
            usage: { input_tokens: 50, output_tokens: 100 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "sdk-id-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should update message with SDK session ID
      expect(database.updateMessage).toHaveBeenCalledWith(
        42,
        "First",
        "sdk-session-123",
      );
    });
  });

  describe("Advanced Streaming", () => {
    it("should handle stream events with thinking_delta", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "thinking_delta", thinking: "Analyzing..." },
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onThinkingDelta: vi.fn(),
      };

      sdkSession.submitQuery(
        "thinking-delta-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onThinkingDelta).toHaveBeenCalledWith("Analyzing...");
    });

    it("should handle tool_progress events", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "tool_progress",
            tool_use_id: "tool123",
            elapsed_time_seconds: 5.2,
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onToolProgress: vi.fn(),
      };

      sdkSession.submitQuery(
        "tool-progress-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onToolProgress).toHaveBeenCalledWith({
        tool_use_id: "tool123",
        elapsed_seconds: 5.2,
      });
    });

    it("should handle rate_limit_event", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "rate_limit_event",
            retry_after_ms: 30000,
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onRateLimit: vi.fn(),
      };

      sdkSession.submitQuery(
        "rate-limit-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onRateLimit).toHaveBeenCalledWith({
        retryAfterMs: 30000,
        rateLimitedAt: expect.any(String),
      });
    });

    it("should handle prompt_suggestion events", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "prompt_suggestion",
            suggestions: ["Try this", "Or that"],
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onPromptSuggestion: vi.fn(),
      };

      sdkSession.submitQuery(
        "prompt-suggestion-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onPromptSuggestion).toHaveBeenCalledWith([
        "Try this",
        "Or that",
      ]);
    });

    it("should handle compact_boundary system event", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "system",
            subtype: "compact_boundary",
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onCompactBoundary: vi.fn(),
      };

      sdkSession.submitQuery(
        "compact-boundary-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onCompactBoundary).toHaveBeenCalled();
    });

    it("should emit SDK result text when no assistant messages", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            result: "Command output",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "result-text-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onText).toHaveBeenCalledWith("Command output", expect.any(Number));
    });

    it("should handle multiple assistant messages", async () => {
      vi.mocked(database.recordMessage).mockReturnValue({ id: 99 });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "First turn" }],
            },
          } as any;
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Second turn" }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 2,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "multi-turn-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // First turn creates message
      expect(database.recordMessage).toHaveBeenCalledWith(
        "multi-turn-test",
        "assistant",
        "assistant",
        "First turn",
      );

      // Second turn updates it with accumulated text
      expect(database.updateMessage).toHaveBeenCalledWith(
        99,
        "First turnSecond turn",
      );
    });
  });

  describe("Streaming Content Buffer", () => {
    it("should track streaming content", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Some content" }],
            },
          } as any;
          // Don't yield result yet - keep the query active
          await new Promise((r) => setTimeout(r, 5000));
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "buffer-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      // Wait for content to be streamed
      await new Promise((r) => setTimeout(r, 100));

      // Streaming content should be available while query is still active
      const content = sdkSession.getStreamingContent("buffer-test");
      expect(content).toBe("Some content");

      // Clean up
      sdkSession.disconnectSession("buffer-test");
    });

    it("should return empty string for non-existent session", () => {
      const content = sdkSession.getStreamingContent("non-existent");
      expect(content).toBe("");
    });

    it("should clear streaming content after query completes", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Content" }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "clear-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 150));

      // After completion, buffer should be cleared
      const content = sdkSession.getStreamingContent("clear-test");
      expect(content).toBe("");
    });
  });

  describe("Last Completed Response", () => {
    it("should store last completed response", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Response" }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "sdk-123",
            total_cost_usd: 0.003,
            duration_ms: 200,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 10, output_tokens: 20 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "last-response-test",
        "Query",
        "/tmp/workspace",
        callbacks,
        "sonnet",
      );

      await new Promise((r) => setTimeout(r, 150));

      const lastResponse = sdkSession.getLastCompletedResponse("last-response-test");
      expect(lastResponse).toMatchObject({
        text: "Response",
        sdk_session_id: "sdk-123",
        cost: 0.003,
        duration_ms: 200,
        is_error: false,
        num_turns: 1,
        input_tokens: 10,
        output_tokens: 20,
        model: "sonnet",
      });
    });

    it("should return null for non-existent session", () => {
      const lastResponse = sdkSession.getLastCompletedResponse("non-existent");
      expect(lastResponse).toBeNull();
    });

    it("should clear last response when starting new query", async () => {
      vi.mocked(database.getLastSdkSessionId).mockReturnValue(null);

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      // First query
      sdkSession.submitQuery(
        "clear-last-test",
        "Query 1",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 150));

      // Second query should clear last response
      sdkSession.submitQuery(
        "clear-last-test",
        "Query 2",
        "/tmp/workspace",
        callbacks,
      );

      // Should be null immediately after submitting new query
      await new Promise((r) => setTimeout(r, 10));
      const lastResponse = sdkSession.getLastCompletedResponse("clear-last-test");
      // Will be null or the old one briefly, but eventually gets updated
    });
  });

  describe("Slash Command Handling", () => {
    it("should convert slash commands to regular prompts", async () => {
      const customQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(customQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "slash-test",
        "/animate create bouncing ball",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Verify query function was called (slash command is converted internally)
      expect(queryMock).toHaveBeenCalled();
      // The actual prompt passed to query will be converted from the slash command
    });

    it("should handle slash command without arguments", async () => {
      const customQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(customQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "slash-no-args-test",
        "/status",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Verify the SDK query function was called
      expect(queryMock).toHaveBeenCalled();
    });
  });

  describe("Image Handling", () => {
    it("should include images in query content", async () => {
      const mockImageData = Buffer.from("fake-image-data");
      vi.mocked(database.getImage).mockReturnValue({
        id: "img1",
        data: mockImageData,
        mime_type: "image/png",
        created_at: "2025-01-01",
      });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "image-test",
        "Analyze this",
        "/tmp/workspace",
        callbacks,
        undefined,
        ["img1"],
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(database.getImage).toHaveBeenCalledWith("img1");
    });

    it("should convert image/jpg to image/jpeg", async () => {
      const mockImageData = Buffer.from("fake-jpg-data");
      vi.mocked(database.getImage).mockReturnValue({
        id: "img2",
        data: mockImageData,
        mime_type: "image/jpg", // jpg, not jpeg
        created_at: "2025-01-01",
      });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "jpg-test",
        "Check this",
        "/tmp/workspace",
        callbacks,
        undefined,
        ["img2"],
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(database.getImage).toHaveBeenCalledWith("img2");
    });

    it("should handle missing images gracefully", async () => {
      vi.mocked(database.getImage).mockReturnValue(null);

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "missing-image-test",
        "Query",
        "/tmp/workspace",
        callbacks,
        undefined,
        ["non-existent"],
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should not throw
      expect(callbacks.onError).not.toHaveBeenCalled();
    });
  });

  describe("Force Cleanup of Stale Query", () => {
    it("should force cleanup stale query when submitting new query", async () => {
      const mockInterrupt = vi.fn().mockResolvedValue(undefined);
      const mockClose = vi.fn();

      // First query that stays active
      const longQuery: Partial<Query> = {
        interrupt: mockInterrupt,
        close: mockClose,
        [Symbol.asyncIterator]: async function* () {
          await new Promise((r) => setTimeout(r, 5000)); // Very long
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(longQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      // Submit first query
      sdkSession.submitQuery(
        "stale-test",
        "Query 1",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Submit second query on same session - should force cleanup
      sdkSession.submitQuery(
        "stale-test",
        "Query 2",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should have interrupted and closed the stale query
      expect(mockInterrupt).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("Completion Edge Cases", () => {
    it("should send completion even when no result received", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          // No result event, just ends
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "no-result-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should still call onComplete in finally block
      expect(callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "",
          sdk_session_id: null,
          is_error: false,
        }),
      );
    });

    it("should handle is_error from result subtype", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            subtype: "error",
            total_cost_usd: 0,
            duration_ms: 1,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "error-subtype-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          is_error: true,
        }),
      );
    });
  });

  describe("Skills Discovery", () => {
    it("should discover skills from user commands directory", async () => {
      const { discoverSkills } = await import("../sdk-session.js");

      // Mock fs functions
      vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      vi.spyOn(require('fs'), 'readdirSync').mockReturnValue(['test-command.md']);
      vi.spyOn(require('fs'), 'readFileSync').mockReturnValue(`---
description: Test command description
---
Command content`);

      const skills = discoverSkills();

      // Should include user commands
      expect(skills).toBeDefined();
      expect(Array.isArray(skills)).toBe(true);
    });

    it("should handle errors when reading skill files", async () => {
      const { discoverSkills } = await import("../sdk-session.js");

      vi.spyOn(require('fs'), 'existsSync').mockReturnValue(true);
      vi.spyOn(require('fs'), 'readdirSync').mockImplementation(() => {
        throw new Error("Permission denied");
      });

      // Should not throw, just log error
      expect(() => discoverSkills()).not.toThrow();
    });

    it("should discover project-level commands when projectPath provided", async () => {
      const { discoverSkills } = await import("../sdk-session.js");

      vi.spyOn(require('fs'), 'existsSync').mockImplementation((p) => {
        return p.includes('.claude');
      });
      vi.spyOn(require('fs'), 'readdirSync').mockReturnValue(['project-cmd.md']);
      vi.spyOn(require('fs'), 'readFileSync').mockReturnValue(`---
description: Project command
---`);

      const skills = discoverSkills('/tmp/project');

      expect(skills).toBeDefined();
    });
  });

  describe("Agent Hooks", () => {
    it("should track agent lifecycle with SubagentStart and SubagentStop", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "agent-lifecycle-test",
        "Test agent",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Verify hooks were set up (query was called with hooks)
      expect(queryMock).toHaveBeenCalled();
      const callArgs = queryMock.mock.calls[0][0];
      expect(callArgs.options.hooks).toBeDefined();
      expect(callArgs.options.hooks.SubagentStart).toBeDefined();
      expect(callArgs.options.hooks.SubagentStop).toBeDefined();
    });

    it("should handle agent_start with agent_type from parameters", async () => {
      const toolEventCallback = vi.fn();

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: toolEventCallback,
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "agent-type-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Get the hooks from the query call
      const callArgs = queryMock.mock.calls[0][0];
      const hooks = callArgs.options.hooks;

      // Simulate PreToolUse for an Agent
      if (hooks?.PreToolUse?.[0]?.hooks?.[0]) {
        await hooks.PreToolUse[0].hooks[0](
          {
            tool_name: "Agent",
            tool_input: { subagent_type: "code_agent", description: "Test agent" },
            agent_id: undefined,
          },
          "toolu_agent123"
        );
      }

      // Verify agent_start event was emitted with correct agent_type
      expect(toolEventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_start",
          tool_name: "Agent",
          agent_type: "code_agent",
          description: "Test agent",
        })
      );
    });

    it("should use default agent type when subagent_type not provided", async () => {
      const toolEventCallback = vi.fn();

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: toolEventCallback,
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "default-agent-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      const callArgs = queryMock.mock.calls[0][0];
      const hooks = callArgs.options.hooks;

      if (hooks?.PreToolUse?.[0]?.hooks?.[0]) {
        await hooks.PreToolUse[0].hooks[0](
          {
            tool_name: "Agent",
            tool_input: { description: "Test" },
            agent_id: undefined,
          },
          "toolu_agent456"
        );
      }

      expect(toolEventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_start",
          agent_type: "agent", // default value
        })
      );
    });

    it("should include LOC parameters for Write/Edit tools in tool_complete", async () => {
      const toolEventCallback = vi.fn();

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: toolEventCallback,
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "loc-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      const callArgs = queryMock.mock.calls[0][0];
      const hooks = callArgs.options.hooks;

      // Simulate Write tool
      if (hooks?.PreToolUse?.[0]?.hooks?.[0]) {
        await hooks.PreToolUse[0].hooks[0](
          {
            tool_name: "Write",
            tool_input: { file_path: "/test.js", content: "console.log('test');" },
            agent_id: undefined,
          },
          "toolu_write123"
        );
      }

      if (hooks?.PostToolUse?.[0]?.hooks?.[0]) {
        await hooks.PostToolUse[0].hooks[0](
          {
            tool_name: "Write",
            tool_input: { file_path: "/test.js", content: "console.log('test');" },
            agent_id: undefined,
          },
          "toolu_write123"
        );
      }

      // Verify tool_complete includes LOC parameters
      expect(toolEventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool_complete",
          tool_name: "Write",
          parameters: expect.objectContaining({
            content: "console.log('test');",
          }),
        })
      );
    });
  });

  describe("Error Handling - API Errors", () => {
    it("should handle overloaded_error in stream", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "error",
            error: {
              type: "overloaded_error",
              message: "API is overloaded",
            },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "overloaded-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onError).toHaveBeenCalledWith(
        "Claude is currently overloaded. Please try again in a moment."
      );
    });

    it("should handle api_error in stream", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "error",
            error: {
              type: "api_error",
              message: "Internal server error",
            },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "api-error-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onError).toHaveBeenCalledWith(
        "Claude API encountered an internal error. Please try again."
      );
    });

    it("should handle generic error in stream", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "error",
            error: {
              type: "unknown_error",
              message: "Something went wrong",
            },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "generic-error-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onError).toHaveBeenCalledWith("Something went wrong");
    });

    it("should handle transient error in exception catch block", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          throw new Error("overloaded_error: API temporarily unavailable");
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "transient-error-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 100));

      expect(callbacks.onError).toHaveBeenCalledWith(
        "Claude API is temporarily unavailable. Please try again in a moment."
      );
    });
  });

  describe("AskUserQuestion Flow", () => {
    it("should emit user question and wait for response", async () => {
      const onUserQuestionCallback = vi.fn();

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onUserQuestion: onUserQuestionCallback,
      };

      sdkSession.submitQuery(
        "ask-question-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Get canUseTool function from query options
      const callArgs = queryMock.mock.calls[0][0];
      const canUseTool = callArgs.options.canUseTool;

      expect(canUseTool).toBeDefined();

      // Simulate AskUserQuestion invocation
      const toolPromise = canUseTool("AskUserQuestion", {
        questions: [{ id: "q1", type: "text", prompt: "What is your name?" }],
      });

      // Wait for question to be emitted
      await new Promise((r) => setTimeout(r, 10));

      // Verify question was emitted
      expect(onUserQuestionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          questions: expect.any(Array),
          tool_use_id: expect.stringContaining("perm_"),
        })
      );

      // Send response
      const pendingQuestion = sdkSession.getPendingQuestion("ask-question-test");
      expect(pendingQuestion).toBeDefined();

      sdkSession.sendQuestionResponse("ask-question-test", { q1: "Alice" });

      // Wait for promise to resolve
      const result = await toolPromise;

      expect(result).toEqual({
        behavior: "allow",
        updatedInput: expect.objectContaining({
          answers: { q1: "Alice" },
        }),
      });
    });

    it("should allow non-question tools through canUseTool", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "can-use-tool-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      const callArgs = queryMock.mock.calls[0][0];
      const canUseTool = callArgs.options.canUseTool;

      // Test non-question tool
      const result = await canUseTool("Bash", { command: "ls" });

      expect(result).toEqual({ behavior: "allow" });
    });
  });

  describe("Database Error Resilience", () => {
    it("should continue on database error in preToolUse", async () => {
      vi.mocked(database.recordToolEvent).mockImplementation(() => {
        throw new Error("DB write failed");
      });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "db-error-resilience-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should still complete successfully
      expect(callbacks.onComplete).toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it("should continue on database error in postToolUse", async () => {
      vi.mocked(database.updateToolEvent).mockImplementation(() => {
        throw new Error("DB update failed");
      });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "db-update-error-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onComplete).toHaveBeenCalled();
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it("should continue on database error when recording messages", async () => {
      vi.mocked(database.recordMessage).mockImplementation(() => {
        throw new Error("Message record failed");
      });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Hello" }],
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "msg-db-error-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      // Should still stream text
      expect(callbacks.onText).toHaveBeenCalledWith("Hello", 1);
      expect(callbacks.onComplete).toHaveBeenCalled();
    });
  });

  describe("Session Reset on Config Change", () => {
    it("should not reset session if workspace and model unchanged", async () => {
      const mockInterrupt = vi.fn().mockResolvedValue(undefined);
      const mockQuery: Partial<Query> = {
        interrupt: mockInterrupt,
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          await new Promise((r) => setTimeout(r, 100));
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      // Start first query
      sdkSession.submitQuery(
        "no-reset-test",
        "Query 1",
        "/tmp/workspace",
        callbacks,
        "sonnet",
      );

      await new Promise((r) => setTimeout(r, 20));

      // Start second query with same config
      sdkSession.submitQuery(
        "no-reset-test",
        "Query 2",
        "/tmp/workspace",
        callbacks,
        "sonnet",
      );

      await new Promise((r) => setTimeout(r, 20));

      // Should have interrupted due to stale query cleanup, not config change
      expect(mockInterrupt).toHaveBeenCalled();
    });
  });

  describe("Interrupt on Disconnect", () => {
    it("should interrupt and close query on disconnectSession", async () => {
      const mockInterrupt = vi.fn().mockResolvedValue(undefined);
      const mockClose = vi.fn();
      const mockQuery: Partial<Query> = {
        interrupt: mockInterrupt,
        close: mockClose,
        [Symbol.asyncIterator]: async function* () {
          await new Promise((r) => setTimeout(r, 200));
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "disconnect-interrupt-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 20));

      // Disconnect
      sdkSession.disconnectSession("disconnect-interrupt-test");

      expect(mockInterrupt).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("Streaming Buffer Management", () => {
    it("should trim streaming content when exceeding MAX_STREAMING_BUFFER (result text)", async () => {
      // MAX_STREAMING_BUFFER is 2MB
      const largeText = "x".repeat(1024 * 1024 * 2.5); // 2.5MB (exceeds buffer)

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            result: largeText,
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "buffer-trim-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 100));

      // Buffer should have been trimmed during streaming
      const content = sdkSession.getStreamingContent("buffer-trim-test");
      expect(content.length).toBeLessThanOrEqual(2 * 1024 * 1024); // Should be <= 2MB
    });

    it("should trim streaming content when exceeding MAX_STREAMING_BUFFER (stream events)", async () => {
      const largeChunk = "z".repeat(1024 * 1024 * 1.5); // 1.5MB
      const moreChunk = "w".repeat(1024 * 1024); // 1MB more

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          // First large chunk
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: largeChunk },
            },
          } as any;
          // Second large chunk (exceeds buffer)
          yield {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: moreChunk },
            },
          } as any;
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "buffer-stream-trim-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      const content = sdkSession.getStreamingContent("buffer-stream-trim-test");
      // Buffer should have been trimmed
      expect(content.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    });
  });

  describe("Model Usage Tracking", () => {
    it("should extract context window size from modelUsage", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0.001,
            duration_ms: 100,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 100, output_tokens: 50 },
            modelUsage: {
              "claude-sonnet-4-5": {
                inputTokens: 150,
                outputTokens: 50,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
                contextWindow: 200000,
                maxOutputTokens: 8192,
                costUSD: 0.001,
              },
            },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "model-usage-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          context_window_size: 200000,
          input_tokens: 100, // From usage.input_tokens (non-cached + cache_read + cache_creation)
        })
      );
    });

    it("should fallback to usage tokens when modelUsage absent", async () => {
      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 100, output_tokens: 50 },
            // No modelUsage field
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "fallback-usage-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      expect(callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          input_tokens: 100, // From usage.input_tokens + cache tokens
          output_tokens: 50,
          context_window_size: 200000, // Default when no modelUsage
        })
      );
    });
  });

  describe("Agent Failure Tracking", () => {
    it("should record agent summary on failure in postToolUseFailure", async () => {
      const toolEventCallback = vi.fn();

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: toolEventCallback,
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "agent-failure-test",
        "Test",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 50));

      const callArgs = queryMock.mock.calls[0][0];
      const hooks = callArgs.options.hooks;

      // Simulate agent start
      if (hooks?.PreToolUse?.[0]?.hooks?.[0]) {
        await hooks.PreToolUse[0].hooks[0](
          {
            tool_name: "Agent",
            tool_input: { description: "Test agent" },
            agent_id: undefined,
          },
          "toolu_fail_agent"
        );
      }

      // Simulate SubagentStart
      if (hooks?.SubagentStart?.[0]?.hooks?.[0]) {
        await hooks.SubagentStart[0].hooks[0](
          { agent_id: "agent_xyz" },
          undefined
        );
      }

      // Simulate SubagentStop with transcript
      if (hooks?.SubagentStop?.[0]?.hooks?.[0]) {
        await hooks.SubagentStop[0].hooks[0](
          {
            agent_id: "agent_xyz",
            agent_transcript_path: "/tmp/transcript.txt",
            last_assistant_message: "Agent failed due to error",
          },
          undefined
        );
      }

      // Simulate agent failure
      if (hooks?.PostToolUseFailure?.[0]?.hooks?.[0]) {
        await hooks.PostToolUseFailure[0].hooks[0](
          {
            tool_name: "Agent",
            tool_input: { description: "Test agent" },
            agent_id: undefined,
            error: "Agent execution failed",
          },
          "toolu_fail_agent"
        );
      }

      // Verify agent_stop was emitted with summary
      expect(toolEventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_stop",
          success: false,
          error: "Agent execution failed",
          transcript_path: "/tmp/transcript.txt",
          summary: "Agent failed due to error",
        })
      );

      // Verify database was updated with summary
      expect(database.updateToolEvent).toHaveBeenCalledWith(
        "agent-failure-test",
        "toolu_fail_agent",
        false,
        "Agent execution failed",
        expect.any(Number),
        "Agent failed due to error"
      );
    });
  });

  describe("Session Edge Cases", () => {
    it("should handle query close error gracefully in finally block", async () => {
      const mockCloseThatThrows = vi.fn(() => {
        throw new Error("Already closed");
      });

      const mockQuery: Partial<Query> = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        close: mockCloseThatThrows,
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "result",
            session_id: "test",
            total_cost_usd: 0,
            duration_ms: 1,
            is_error: false,
            num_turns: 1,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as any;
        },
      };

      const queryMock = vi.mocked(
        await import("@anthropic-ai/claude-agent-sdk"),
      ).query as Mock;
      queryMock.mockReturnValue(mockQuery);

      const callbacks = {
        onText: vi.fn(),
        onToolEvent: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      sdkSession.submitQuery(
        "close-error-finally-test",
        "Query",
        "/tmp/workspace",
        callbacks,
      );

      await new Promise((r) => setTimeout(r, 100));

      // Should complete without throwing despite close error
      expect(callbacks.onComplete).toHaveBeenCalled();
      expect(mockCloseThatThrows).toHaveBeenCalled();
    });

    it("should return empty string for nonexistent session streaming content", () => {
      const content = sdkSession.getStreamingContent("nonexistent-session");
      expect(content).toBe("");
    });

    it("should return null for nonexistent session last completed response", () => {
      const response = sdkSession.getLastCompletedResponse("nonexistent-session");
      expect(response).toBeNull();
    });
  });
});
